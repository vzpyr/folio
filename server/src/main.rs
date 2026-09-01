mod api;
mod backup;
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
    pub backup: backup::BackupConfig,
}

fn env_required(key: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| {
            eprintln!("error: {key} environment variable is required");
            std::process::exit(1);
        })
}

fn load_config() -> Config {
    let token = env_required("FOLIO_TOKEN").trim().to_string();
    if BASE64.decode(token.as_bytes()).map(|t| t.len()) != Ok(32) {
        eprintln!("error: FOLIO_TOKEN must be a 32-byte base64 key");
        std::process::exit(1);
    }
    let data_dir = env_required("FOLIO_DATA_DIR");
    let host = env_required("FOLIO_HOST");
    let port: u16 = env_required("FOLIO_PORT").parse().unwrap_or_else(|_| {
        eprintln!("error: FOLIO_PORT must be a valid port number (1-65535)");
        std::process::exit(1);
    });
    if !(1..=65535).contains(&port) {
        eprintln!("error: FOLIO_PORT must be a valid port number (1-65535)");
        std::process::exit(1);
    }
    let max_body: usize = env_required("FOLIO_MAX_BODY").parse().unwrap_or_else(|_| {
        eprintln!("error: FOLIO_MAX_BODY must be a positive integer");
        std::process::exit(1);
    });
    let backup = backup::from_env();
    Config {
        token,
        host,
        data_dir: data_dir.clone(),
        port,
        max_body,
        backup,
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

    let backup_cfg = state.config.backup.clone();
    tokio::spawn(backup::run_loop(state.clone(), backup_cfg));

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
