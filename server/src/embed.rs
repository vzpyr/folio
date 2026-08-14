use axum::body::Body;
use axum::http::{HeaderValue, Request, Response, StatusCode, header};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
struct Assets;

fn random_nonce() -> String {
    BASE64.encode(uuid::Uuid::new_v4().as_bytes())
}

fn csp(nonce: &str) -> String {
    format!(
        "default-src 'self'; script-src 'self' 'nonce-{nonce}'; \
         style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; \
         font-src 'self'; connect-src 'self' http: https:; object-src 'none'; \
         base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
}

fn html_with_csp(bytes: &[u8]) -> Response<Body> {
    let nonce = random_nonce();
    let replacement = format!("<script nonce=\"{nonce}\">");
    let html = String::from_utf8_lossy(bytes).replace("<script>", &replacement);
    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache");
    if let Ok(hv) = HeaderValue::from_str(&csp(&nonce)) {
        resp = resp.header(header::CONTENT_SECURITY_POLICY, hv);
    }
    resp.body(Body::from(html.into_bytes())).unwrap()
}

pub async fn serve_static(req: Request<Body>) -> Response<Body> {
    let path = req.uri().path().trim_start_matches('/');

    if let Some(content) = Assets::get(path) {
        if path.ends_with(".html") {
            return html_with_csp(&content.data);
        }
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let cache = if is_hashed_asset(path) {
            "public, immutable, max-age=31536000"
        } else {
            "no-cache"
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, cache)
            .body(Body::from(content.data.to_vec()))
            .unwrap();
    }

    if path == "api" || path.starts_with("api/") {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"error":"not found"}"#))
            .unwrap();
    }

    match Assets::get("index.html") {
        Some(content) => html_with_csp(&content.data),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found"))
            .unwrap(),
    }
}

fn is_hashed_asset(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.contains('-') && name != "index.html"
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn html_has_nonce_csp_and_nonce_tag() {
        let assets = Assets::get("index.html").unwrap();
        let resp = html_with_csp(&assets.data);
        let headers = resp.headers();
        let csp = headers
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(csp.contains("script-src 'self' 'nonce-"));
        assert!(csp.contains("connect-src 'self' http: https:"));
        let bytes = to_bytes(resp.into_body(), 1 << 20).await.unwrap();
        let body = String::from_utf8_lossy(&bytes);
        assert!(body.contains("<script nonce=\""));
        assert_eq!(
            csp.split("'nonce-")
                .nth(1)
                .unwrap()
                .split('\'')
                .next()
                .unwrap(),
            body.split("<script nonce=\"")
                .nth(1)
                .unwrap()
                .split('"')
                .next()
                .unwrap(),
        );
    }
}
