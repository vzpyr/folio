mod api;
mod db;
mod embed;
mod files;
mod sse;

use std::net::SocketAddr;
use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tracing_subscriber::EnvFilter;

pub struct Config {
    pub token: String,
    pub host: String,
    pub data_dir: String,
    pub port: u16,
    pub max_body: usize,
}

const DEFAULT_MAX_BODY: usize = 32 * 1024 * 1024;
const DEFAULT_HOST: &str = "0.0.0.0";

fn load_config() -> Config {
    let token = std::env::var("FOLIO_TOKEN")
        .unwrap_or_default()
        .trim()
        .to_string();
    if BASE64.decode(token.as_bytes()).map(|t| t.len()) != Ok(32) {
        eprintln!("error: FOLIO_TOKEN must be a 32-byte base64 key");
        std::process::exit(1);
    }
    Config {
        token,
        host: std::env::var("FOLIO_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string()),
        data_dir: std::env::var("FOLIO_DATA_DIR").unwrap_or_else(|_| "/data".to_string()),
        port: std::env::var("FOLIO_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8080),
        max_body: std::env::var("FOLIO_MAX_BODY")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_MAX_BODY),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("folio_server=info".parse().unwrap()),
        )
        .init();

    let config = load_config();

    let db = Arc::new(db::open(&config.data_dir).expect("failed to open database"));
    let sse = Arc::new(sse::SseHub::new());
    let state = Arc::new(api::AppState {
        config,
        db,
        sse,
        write_lock: tokio::sync::Mutex::new(()),
    });

    let host = state.config.host.clone();
    let port = state.config.port;
    let addr: SocketAddr = match format!("{host}:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => {
            eprintln!("error: FOLIO_HOST must be an IP literal (got '{host}')");
            std::process::exit(1);
        }
    };
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind");
    tracing::info!("listening on {addr}");
    axum::serve(listener, api::router(state))
        .await
        .expect("server failed");
}
