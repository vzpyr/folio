use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use flate2::Compression;
use flate2::write::GzEncoder;
use tar::Builder;

use crate::api::AppState;
use crate::db;

#[derive(Clone, Debug)]
pub struct BackupConfig {
    pub enabled: bool,
    pub dir: PathBuf,
    pub interval: Duration,
    pub retention: usize,
    pub on_start: bool,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            dir: PathBuf::from("backups"),
            interval: Duration::from_secs(24 * 60 * 60),
            retention: 7,
            on_start: true,
        }
    }
}

fn fail(key: &str, msg: &str) -> ! {
    eprintln!("error: {key}: {msg}");
    std::process::exit(1);
}

fn parse_bool(raw: &str) -> Result<bool, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        other => Err(format!("invalid boolean '{other}'")),
    }
}

fn parse_interval(raw: &str) -> Result<Duration, String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return Err("must not be empty".to_string());
    }
    let (num, unit) = s.split_at(s.len() - 1);
    let n: u64 = num
        .trim()
        .parse()
        .map_err(|_| format!("invalid interval '{raw}'"))?;
    let secs = match unit {
        "s" => Some(n),
        "m" => n.checked_mul(60),
        "h" => n.checked_mul(60 * 60),
        "d" => n.checked_mul(24 * 60 * 60),
        _ => return Err(format!("invalid unit in '{raw}' (expected s, m, h, or d)")),
    }
    .ok_or_else(|| format!("interval '{raw}' out of range"))?;
    if secs == 0 {
        return Err(format!("interval '{raw}' must be greater than zero"));
    }
    Ok(Duration::from_secs(secs))
}

fn parse_retention(raw: &str) -> Result<usize, String> {
    let n: usize = raw
        .trim()
        .parse()
        .map_err(|_| format!("invalid retention '{raw}'"))?;
    if n == 0 {
        return Err(format!("retention '{raw}' must be at least 1"));
    }
    Ok(n)
}

pub fn from_env(data_dir: &str) -> BackupConfig {
    let mut cfg = BackupConfig {
        dir: PathBuf::from(data_dir).join("backups"),
        ..BackupConfig::default()
    };
    if let Ok(v) = std::env::var("FOLIO_BACKUP_ENABLED") {
        cfg.enabled = parse_bool(&v).unwrap_or_else(|e| fail("FOLIO_BACKUP_ENABLED", &e));
    }
    if let Ok(v) = std::env::var("FOLIO_BACKUP_DIR") {
        let p = PathBuf::from(v.trim());
        if p.as_os_str().is_empty() {
            fail("FOLIO_BACKUP_DIR", "must not be empty");
        }
        cfg.dir = if p.is_absolute() {
            p
        } else {
            std::path::absolute(&p).unwrap_or(p)
        };
    }
    if let Ok(v) = std::env::var("FOLIO_BACKUP_INTERVAL") {
        cfg.interval = parse_interval(&v).unwrap_or_else(|e| fail("FOLIO_BACKUP_INTERVAL", &e));
    }
    if let Ok(v) = std::env::var("FOLIO_BACKUP_RETENTION") {
        cfg.retention = parse_retention(&v).unwrap_or_else(|e| fail("FOLIO_BACKUP_RETENTION", &e));
    }
    if let Ok(v) = std::env::var("FOLIO_BACKUP_ON_START") {
        cfg.on_start = parse_bool(&v).unwrap_or_else(|e| fail("FOLIO_BACKUP_ON_START", &e));
    }
    if cfg.enabled {
        fs::create_dir_all(&cfg.dir).unwrap_or_else(|e| {
            fail(
                "FOLIO_BACKUP_DIR",
                &format!("cannot create {}: {e}", cfg.dir.display()),
            )
        });
    }
    cfg
}

pub async fn run_loop(state: Arc<AppState>, cfg: BackupConfig) {
    if !cfg.enabled {
        return;
    }
    if cfg.on_start {
        backup_once(&state, &cfg).await;
    }
    let mut tick = tokio::time::interval_at(
        tokio::time::Instant::now() + cfg.interval,
        cfg.interval,
    );
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        backup_once(&state, &cfg).await;
    }
}

async fn backup_once(state: &Arc<AppState>, cfg: &BackupConfig) {
    let _guard = state.write_lock.lock().await;
    match create_backup(&state.db, &state.config.data_dir, cfg) {
        Ok(path) => tracing::info!("backup written to {}", path.display()),
        Err(e) => tracing::error!("backup failed: {e}"),
    }
}

fn timestamp() -> String {
    static FORMAT: OnceLock<time::format_description::FormatDescriptionV3<'static>> =
        OnceLock::new();
    let format = FORMAT.get_or_init(|| {
        time::format_description::parse_owned::<3>(
            "[year][month][day]T[hour][minute][second]Z",
        )
        .unwrap()
    });
    time::OffsetDateTime::now_utc().format(format).unwrap()
}

fn create_backup(db: &db::Database, data_dir: &str, cfg: &BackupConfig) -> io::Result<PathBuf> {
    fs::create_dir_all(&cfg.dir)?;
    let tmp_dir = cfg.dir.join(".tmp");
    let _ = fs::remove_dir_all(&tmp_dir);
    fs::create_dir_all(&tmp_dir)?;
    let outcome = (|| -> io::Result<PathBuf> {
        let snapshot = tmp_dir.join("folio.db");
        let snapshot_str = snapshot
            .to_str()
            .ok_or_else(|| io::Error::other("backup dir is not valid UTF-8"))?;
        db::vacuum_into(db, snapshot_str).map_err(io::Error::other)?;
        let ts = timestamp();
        let path = cfg.dir.join(format!("folio-{ts}.tar.gz"));
        let tmp_path = cfg.dir.join(format!("folio-{ts}.tar.gz.tmp"));
        let file = File::create(&tmp_path)?;
        let encoder = GzEncoder::new(file, Compression::default());
        let mut builder = Builder::new(encoder);
        builder.append_path_with_name(&snapshot, "folio.db")?;
        let backup_canon = fs::canonicalize(&cfg.dir).unwrap_or_else(|_| cfg.dir.clone());
        add_data(&mut builder, data_dir, &backup_canon)?;
        let encoder = builder.into_inner()?;
        let file = encoder.finish()?;
        file.sync_all()?;
        fs::rename(&tmp_path, &path)?;
        prune(&cfg.dir, cfg.retention)?;
        Ok(path)
    })();
    let _ = fs::remove_dir_all(&tmp_dir);
    outcome
}

fn add_data(
    builder: &mut Builder<GzEncoder<File>>,
    data_dir: &str,
    backup_canon: &Path,
) -> io::Result<()> {
    for entry in fs::read_dir(data_dir)? {
        let entry = entry?;
        let path = entry.path();
        if is_backup_dir(&path, backup_canon) {
            continue;
        }
        add_entry(builder, &path, Path::new(""), backup_canon)?;
    }
    Ok(())
}

fn add_entry(
    builder: &mut Builder<GzEncoder<File>>,
    path: &Path,
    prefix: &Path,
    backup_canon: &Path,
) -> io::Result<()> {
    let name = path.file_name().ok_or_else(|| io::Error::other("invalid path"))?;
    let rel = prefix.join(name);
    let md = fs::metadata(path)?;
    if md.is_dir() {
        builder.append_dir(&rel, path)?;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let p = entry.path();
            if is_backup_dir(&p, backup_canon) {
                continue;
            }
            add_entry(builder, &p, &rel, backup_canon)?;
        }
    } else if md.is_file() {
        let name = name.to_string_lossy();
        if is_skip_file(&name) {
            return Ok(());
        }
        let mut file = File::open(path)?;
        builder.append_file(&rel, &mut file)?;
    }
    Ok(())
}

fn is_backup_dir(path: &Path, backup_canon: &Path) -> bool {
    match fs::canonicalize(path) {
        Ok(canon) => canon == backup_canon,
        Err(_) => path == backup_canon,
    }
}

fn is_skip_file(name: &str) -> bool {
    name == "folio.db" || name.starts_with("folio.db-") || name.ends_with(".tmp")
}

fn prune(dir: &Path, retention: usize) -> io::Result<()> {
    let mut names: Vec<String> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".tar.gz.tmp") {
            let _ = fs::remove_file(entry.path());
        } else if name.starts_with("folio-") && name.ends_with(".tar.gz") {
            names.push(name);
        }
    }
    names.sort();
    let overflow = names.len().saturating_sub(retention);
    for name in names.into_iter().take(overflow) {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "folio-backup-test-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn temp_data() -> (PathBuf, db::Database) {
        let dir = temp_dir();
        let database = db::open(dir.to_str().unwrap()).unwrap();
        (dir, database)
    }

    fn config(dir: &Path, retention: usize) -> BackupConfig {
        BackupConfig {
            enabled: true,
            dir: dir.join("backups"),
            interval: Duration::from_secs(3600),
            retention,
            on_start: true,
        }
    }

    #[test]
    fn bool_parsing() {
        assert!(parse_bool("true").unwrap());
        assert!(parse_bool("TRUE").unwrap());
        assert!(parse_bool("1").unwrap());
        assert!(parse_bool(" 1 ").unwrap());
        assert!(!parse_bool("false").unwrap());
        assert!(!parse_bool("False").unwrap());
        assert!(!parse_bool("0").unwrap());
        assert!(parse_bool("yes").is_err());
        assert!(parse_bool("").is_err());
        assert!(parse_bool("maybe").is_err());
    }

    #[test]
    fn interval_parsing() {
        assert_eq!(parse_interval("30s").unwrap(), Duration::from_secs(30));
        assert_eq!(parse_interval("5m").unwrap(), Duration::from_secs(300));
        assert_eq!(parse_interval("12h").unwrap(), Duration::from_secs(43200));
        assert_eq!(parse_interval("2d").unwrap(), Duration::from_secs(172800));
        assert_eq!(parse_interval(" 24h ").unwrap(), Duration::from_secs(86400));
        assert_eq!(parse_interval("24H").unwrap(), Duration::from_secs(86400));
        assert_eq!(parse_interval("5 h").unwrap(), Duration::from_secs(18000));
        assert!(parse_interval("").is_err());
        assert!(parse_interval("5").is_err());
        assert!(parse_interval("1.5h").is_err());
        assert!(parse_interval("0s").is_err());
        assert!(parse_interval("1x").is_err());
        assert!(parse_interval("abc").is_err());
        assert!(parse_interval("-1h").is_err());
        assert!(parse_interval("18446744073709551615m").is_err());
        assert!(parse_interval("99999999999999999999h").is_err());
    }

    #[test]
    fn retention_parsing() {
        assert_eq!(parse_retention("1").unwrap(), 1);
        assert_eq!(parse_retention("7").unwrap(), 7);
        assert_eq!(parse_retention(" 42 ").unwrap(), 42);
        assert!(parse_retention("0").is_err());
        assert!(parse_retention("-1").is_err());
        assert!(parse_retention("abc").is_err());
        assert!(parse_retention("").is_err());
    }

    #[test]
    fn backup_roundtrip_and_restore() {
        let (dir, database) = temp_data();
        let cfg = config(&dir, 7);
        db::insert_item(&database, "vault-a", "item1").unwrap();
        db::insert_item(&database, "vault-b", "item2").unwrap();
        let envelope = files::Envelope {
            v: 1,
            rev: 1,
            nonce: "AAAA".into(),
            blob: "bXlubG9ibGlzb25nZW5vdWdo".into(),
        };
        files::write_envelope(dir.to_str().unwrap(), &envelope, "vault-a", "item1").unwrap();
        files::write_envelope(dir.to_str().unwrap(), &envelope, "vault-b", "item2").unwrap();
        fs::write(dir.join("folio.db-wal"), "junk").unwrap();

        let path = create_backup(&database, dir.to_str().unwrap(), &cfg).unwrap();
        assert!(path.exists());
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".tar.gz"));
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("folio-20"));
        assert!(!dir.join(".tmp").exists());

        let out = dir.join("restore");
        fs::create_dir_all(&out).unwrap();
        let gz = File::open(&path).unwrap();
        let decoder = flate2::read::GzDecoder::new(gz);
        let mut archive = tar::Archive::new(decoder);
        archive.unpack(&out).unwrap();

        assert!(out.join("folio.db").exists());
        assert!(out.join("vault-a/item1.json").exists());
        assert!(out.join("vault-b/item2.json").exists());
        assert!(!out.join("folio.db-wal").exists());
        assert!(!out.join("backups").exists());

        let restored =
            db::open(out.to_str().unwrap()).unwrap();
        let manifest = db::get_manifest(&restored, "vault-a").unwrap();
        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest[0].0, "item1");
        assert_eq!(manifest[0].1, 1);
        let read = files::read_envelope(out.to_str().unwrap(), "vault-a", "item1").unwrap();
        assert_eq!(read.rev, 1);
        assert_eq!(read.blob, "bXlubG9ibGlzb25nZW5vdWdo");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backup_tmp_is_cleaned_after_failure() {
        let (dir, database) = temp_data();
        let cfg = config(&dir, 7);
        let result = create_backup(&database, "/nonexistent-data-dir", &cfg);
        assert!(result.is_err());
        assert!(!dir.join(".tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prune_keeps_newest() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        for i in 0..10 {
            let name = format!("folio-2026021{i}T000000Z.tar.gz");
            fs::write(dir.join(name), "x").unwrap();
        }
        fs::write(dir.join("folio-20260211T000000Z.tar.gz.tmp"), "x").unwrap();
        prune(&dir, 3).unwrap();
        let remaining: Vec<_> = fs::read_dir(&dir).unwrap().collect();
        assert_eq!(remaining.len(), 3);
        assert!(!dir.join("folio-20260210T000000Z.tar.gz").exists());
        assert!(!dir.join("folio-20260216T000000Z.tar.gz").exists());
        assert!(dir.join("folio-20260217T000000Z.tar.gz").exists());
        assert!(dir.join("folio-20260219T000000Z.tar.gz").exists());
        assert!(!dir.join("folio-20260211T000000Z.tar.gz.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prune_keeps_all_when_under_retention() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        for i in 0..2 {
            let name = format!("folio-2026021{i}T000000Z.tar.gz");
            fs::write(dir.join(name), "x").unwrap();
        }
        prune(&dir, 7).unwrap();
        let remaining: Vec<_> = fs::read_dir(&dir).unwrap().collect();
        assert_eq!(remaining.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }
}
