use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderValue, Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, de::DeserializeOwned};
use subtle::ConstantTimeEq;
use tower_http::cors::{Any, CorsLayer};

use crate::{Config, db, embed, files, sse};

type ApiError = (StatusCode, String);

const MAX_NONCE_BYTES: usize = 32;
const MIN_BLOB_BYTES: usize = 16;

pub struct AppState {
    pub config: Config,
    pub db: Arc<db::Database>,
    pub sse: Arc<sse::SseHub>,
    pub write_lock: tokio::sync::Mutex<()>,
}

fn json_error(msg: &str) -> String {
    serde_json::json!({"error": msg}).to_string()
}

fn err400(msg: &str) -> ApiError {
    (StatusCode::BAD_REQUEST, json_error(msg))
}

fn err401() -> ApiError {
    (StatusCode::UNAUTHORIZED, json_error("unauthorized"))
}

fn err404() -> ApiError {
    (StatusCode::NOT_FOUND, json_error("not found"))
}

fn err409() -> ApiError {
    (StatusCode::CONFLICT, json_error("conflict"))
}

fn err500(msg: impl std::fmt::Display) -> ApiError {
    tracing::error!("{msg}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        json_error("internal server error"),
    )
}

fn parse_json<T: DeserializeOwned>(body: &str, ctx: &str) -> Result<T, ApiError> {
    serde_json::from_str(body).map_err(|e| {
        tracing::debug!("invalid json for {ctx}: {e}");
        err400("invalid json")
    })
}

fn validate_token_id(s: &str) -> Result<(), &'static str> {
    let bytes = s.as_bytes();
    if (20..=64).contains(&bytes.len())
        && bytes
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        Ok(())
    } else {
        Err("invalid id")
    }
}

fn decode_b64(s: &str, label: &str, min_len: usize) -> Result<Vec<u8>, &'static str> {
    let bytes = BASE64.decode(s).map_err(|_| "invalid base64")?;
    if bytes.len() < min_len {
        return Err(match label {
            "nonce" => "nonce too short",
            _ => "blob too short",
        });
    }
    Ok(bytes)
}

async fn security_headers(request: Request<Body>, next: Next) -> Response {
    let is_api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    if is_api {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let path = request.uri().path();
    let is_public = path == "/api/health" || !path.starts_with("/api/");
    if !is_public {
        let authorized = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .is_some_and(|token| bool::from(token.as_bytes().ct_eq(state.config.token.as_bytes())));
        if !authorized {
            return err401().into_response();
        }
    }
    next.run(request).await
}

#[derive(Deserialize)]
struct PutBody {
    base_rev: i64,
    nonce: String,
    blob: String,
}

async fn health() -> impl IntoResponse {
    axum::Json(serde_json::json!({"ok": true}))
}

const MAX_BATCH_IDS: usize = 500;

#[derive(Deserialize)]
struct BatchBody {
    ids: Vec<String>,
}

async fn get_batch(
    State(state): State<Arc<AppState>>,
    Path(vault_id): Path<String>,
    body: String,
) -> Result<impl IntoResponse, ApiError> {
    validate_token_id(&vault_id).map_err(err400)?;
    let body: BatchBody = parse_json(&body, "POST batch")?;
    if body.ids.len() > MAX_BATCH_IDS {
        return Err(err400("too many ids"));
    }
    let mut items = Vec::with_capacity(body.ids.len());
    for id in &body.ids {
        validate_token_id(id).map_err(err400)?;
        if let Some(env) = files::read_envelope(&state.config.data_dir, &vault_id, id) {
            items.push(serde_json::json!({
                "id": id,
                "v": env.v,
                "rev": env.rev,
                "nonce": env.nonce,
                "blob": env.blob,
            }));
        }
    }
    Ok(axum::Json(serde_json::json!({ "items": items })))
}

async fn get_manifest(
    State(state): State<Arc<AppState>>,
    Path(vault_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    validate_token_id(&vault_id).map_err(err400)?;
    let items = db::get_manifest(&state.db, &vault_id)
        .map_err(err500)?
        .iter()
        .map(|(id, rev)| serde_json::json!({ "id": id, "rev": rev }))
        .collect::<Vec<_>>();
    Ok(axum::Json(serde_json::json!({"items": items})))
}

async fn get_item(
    State(state): State<Arc<AppState>>,
    Path((vault_id, id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    validate_token_id(&vault_id).map_err(err400)?;
    validate_token_id(&id).map_err(err400)?;
    let envelope =
        files::read_envelope(&state.config.data_dir, &vault_id, &id).ok_or_else(err404)?;
    Ok(axum::Json(envelope))
}

async fn put_item(
    State(state): State<Arc<AppState>>,
    Path((vault_id, id)): Path<(String, String)>,
    body: String,
) -> Result<impl IntoResponse, ApiError> {
    validate_token_id(&vault_id).map_err(err400)?;
    validate_token_id(&id).map_err(err400)?;

    let _write_guard = state.write_lock.lock().await;

    let body: PutBody = parse_json(&body, "PUT item")?;
    if body.base_rev < 0 {
        return Err(err400("base_rev must be >= 0"));
    }
    if body.nonce.len() > ((MAX_NONCE_BYTES + 2) / 3) * 4 {
        return Err(err400("nonce exceeds 32 bytes"));
    }
    let nonce = decode_b64(&body.nonce, "nonce", 0).map_err(err400)?;
    if nonce.len() > MAX_NONCE_BYTES {
        return Err(err400("nonce exceeds 32 bytes"));
    }
    decode_b64(&body.blob, "blob", MIN_BLOB_BYTES).map_err(err400)?;

    let previous = files::read_envelope(&state.config.data_dir, &vault_id, &id);

    let new_rev = if body.base_rev == 0 {
        1
    } else {
        body.base_rev.saturating_add(1)
    };
    let envelope = files::Envelope {
        v: 1,
        rev: new_rev,
        nonce: body.nonce,
        blob: body.blob,
    };
    files::write_envelope(&state.config.data_dir, &envelope, &vault_id, &id).map_err(err500)?;

    let result = if body.base_rev == 0 {
        db::insert_item(&state.db, &vault_id, &id)
    } else {
        db::advance_item(&state.db, &vault_id, &id, body.base_rev)
    };

    match result {
        Ok(Some(rev)) => {
            state.sse.broadcast(&vault_id);
            Ok(axum::Json(serde_json::json!({"rev": rev})))
        }
        Ok(None) => {
            restore_envelope(&state.config.data_dir, &vault_id, &id, previous.as_ref());
            Err(err409())
        }
        Err(e) => {
            restore_envelope(&state.config.data_dir, &vault_id, &id, previous.as_ref());
            Err(err500(e))
        }
    }
}

fn restore_envelope(data_dir: &str, vault_id: &str, id: &str, previous: Option<&files::Envelope>) {
    let result = match previous {
        Some(env) => files::write_envelope(data_dir, env, vault_id, id),
        None => files::remove_envelope(data_dir, vault_id, id),
    };
    if let Err(e) = result {
        tracing::warn!("failed to restore envelope {id}: {e}");
    }
}

async fn sse_events(
    State(state): State<Arc<AppState>>,
    Path(vault_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    validate_token_id(&vault_id).map_err(err400)?;

    let mut rx = state.sse.subscribe(&vault_id);

    let stream = async_stream::stream! {
        loop {
            tokio::select! {
                evt = rx.recv() => match evt {
                    Ok(()) => {
                        yield Ok::<_, std::convert::Infallible>("event: change\ndata: {}\n\n".to_string());
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                _ = tokio::time::sleep(std::time::Duration::from_secs(25)) => {
                    yield Ok::<_, std::convert::Infallible>(": ping\n\n".to_string());
                }
            }
        }
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap())
}

pub fn router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route("/api/health", get(health))
        .route("/api/vaults/{vault_id}/manifest", get(get_manifest))
        .route(
            "/api/vaults/{vault_id}/items/{id}",
            get(get_item).put(put_item),
        )
        .route("/api/vaults/{vault_id}/batch", post(get_batch))
        .route("/api/vaults/{vault_id}/events", get(sse_events));

    let static_fallback = Router::new().fallback(embed::serve_static);

    Router::new()
        .merge(api)
        .merge(static_fallback)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .layer(DefaultBodyLimit::max(state.config.max_body))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
                .allow_methods([Method::GET, Method::PUT, Method::POST, Method::OPTIONS]),
        )
        .layer(middleware::from_fn(security_headers))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    fn test_app() -> (Router, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("folio-api-test-{}", uuid::Uuid::new_v4()));
        let state = Arc::new(AppState {
            config: Config {
                token: "test-token".into(),
                host: "0.0.0.0".into(),
                data_dir: dir.to_str().unwrap().into(),
                port: 8080,
                max_body: 1_000_000,
            },
            db: Arc::new(db::open(dir.to_str().unwrap()).unwrap()),
            sse: Arc::new(sse::SseHub::new()),
            write_lock: tokio::sync::Mutex::new(()),
        });
        (router(state), dir)
    }

    #[test]
    fn token_id_validation() {
        assert!(validate_token_id(ID).is_ok());
        assert!(validate_token_id("short").is_err());
        assert!(validate_token_id("has space here").is_err());
        assert!(validate_token_id(&"a".repeat(65)).is_err());
    }

    #[test]
    fn base64_decode_and_min_length_rules() {
        assert!(decode_b64("AAAA", "nonce", 0).is_ok());
        assert!(decode_b64("!!!", "nonce", 0).is_err());
        assert!(decode_b64("QQ==", "blob", 16).is_err());
        assert!(decode_b64("bXlubG9ibGlzb25nZW5vdWdo", "blob", 16).is_ok());
    }

    use axum::body::to_bytes;
    use tower::ServiceExt;

    #[tokio::test]
    async fn api_requires_token() {
        let (app, dir) = test_app();
        let res = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/vaults/{ID}/manifest"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn responses_include_security_headers() {
        let (app, dir) = test_app();
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
            "nosniff"
        );
        assert_eq!(res.headers().get(header::X_FRAME_OPTIONS).unwrap(), "DENY");
        assert_eq!(
            res.headers().get(header::REFERRER_POLICY).unwrap(),
            "no-referrer"
        );
        assert_eq!(
            res.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let body = to_bytes(res.into_body(), 1024).await.unwrap();
        assert!(body.starts_with(b"{\"ok\":true}"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn batch_returns_found_envelopes() {
        let (app, dir) = test_app();
        let vault = ID;
        let item = ID;
        let put = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/vaults/{vault}/items/{item}"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"base_rev": 0, "nonce": "QUJDRA==", "blob": "bXlubG9ibGlzb25nZW5vdWdo"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);

        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/vaults/{vault}/batch"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"ids": ["{item}", "missingmissingmissingmissing1"]}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let items = parsed["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], item);
        assert_eq!(items[0]["rev"], 1);
        assert_eq!(items[0]["blob"], "bXlubG9ibGlzb25nZW5vdWdo");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn batch_caps_ids_and_requires_auth() {
        let (app, dir) = test_app();
        let vault = ID;
        let ids: Vec<String> = (0..501).map(|i| format!("id{i:03}")).collect();
        let body = serde_json::json!({ "ids": ids }).to_string();
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/vaults/{vault}/batch"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/vaults/{vault}/batch"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"ids": []}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn reject_oversized_nonce_before_decode() {
        let (app, dir) = test_app();
        let long_nonce = BASE64.encode(vec![0u8; 64]);
        let res = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/vaults/{ID}/items/{ID}"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"base_rev": 0, "nonce": "{long_nonce}", "blob": "bXlubG9ibGlzb25nZW5vdWdo"}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn accept_32_byte_nonce_boundary() {
        let (app, dir) = test_app();
        let nonce = BASE64.encode(vec![0xAB; 32]);
        let res = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/vaults/{ID}/items/{ID}"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"base_rev": 0, "nonce": "{nonce}", "blob": "bXlubG9ibGlzb25nZW5vdWdo"}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn reject_negative_base_rev() {
        let (app, dir) = test_app();
        let res = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/vaults/{ID}/items/{ID}"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"base_rev": -1, "nonce": "AAAA", "blob": "AA=="}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(res.into_body(), 1024).await.unwrap();
        assert_eq!(&body[..], b"{\"error\":\"base_rev must be >= 0\"}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
