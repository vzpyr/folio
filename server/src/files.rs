use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub rev: i64,
    pub nonce: String,
    pub blob: String,
}

fn envelope_path(data_dir: &str, vault_id: &str, id: &str) -> PathBuf {
    PathBuf::from(data_dir)
        .join(vault_id)
        .join(format!("{id}.json"))
}

pub fn write_envelope(
    data_dir: &str,
    envelope: &Envelope,
    vault_id: &str,
    id: &str,
) -> io::Result<()> {
    let path = envelope_path(data_dir, vault_id, id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec(envelope).map_err(io::Error::other)?,
    )?;
    std::fs::rename(&tmp, &path)
}

pub fn read_envelope(data_dir: &str, vault_id: &str, id: &str) -> Option<Envelope> {
    let path = envelope_path(data_dir, vault_id, id);
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn remove_envelope(data_dir: &str, vault_id: &str, id: &str) -> io::Result<()> {
    let path = envelope_path(data_dir, vault_id, id);
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareEnvelope {
    pub v: u32,
    pub nonce: String,
    pub blob: String,
}

fn share_path(data_dir: &str, id: &str) -> PathBuf {
    PathBuf::from(data_dir)
        .join("shares")
        .join(format!("{id}.json"))
}

pub fn write_share_envelope(data_dir: &str, envelope: &ShareEnvelope, id: &str) -> io::Result<()> {
    let path = share_path(data_dir, id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec(envelope).map_err(io::Error::other)?,
    )?;
    std::fs::rename(&tmp, &path)
}

pub fn read_share_envelope(data_dir: &str, id: &str) -> Option<ShareEnvelope> {
    let path = share_path(data_dir, id);
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn remove_share_envelope(data_dir: &str, id: &str) -> io::Result<()> {
    let path = share_path(data_dir, id);
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    fn temp_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("folio-files-test-{}", uuid::Uuid::new_v4()))
    }

    fn envelope() -> Envelope {
        Envelope {
            v: 1,
            rev: 3,
            nonce: "abcd".into(),
            blob: "xyz".into(),
        }
    }

    #[test]
    fn layout_is_vault_id_id_json() {
        let dir = temp_dir();
        write_envelope(dir.to_str().unwrap(), &envelope(), "vaultid", ID).unwrap();
        let expected = dir.join("vaultid").join(format!("{ID}.json"));
        assert!(expected.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = temp_dir();
        let env = envelope();
        write_envelope(dir.to_str().unwrap(), &env, "vaultid", ID).unwrap();
        let read = read_envelope(dir.to_str().unwrap(), "vaultid", ID).unwrap();
        assert_eq!(read.rev, env.rev);
        assert_eq!(read.blob, "xyz");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_is_atomic_and_leaves_no_temp_file() {
        let dir = temp_dir();
        write_envelope(dir.to_str().unwrap(), &envelope(), "vaultid", ID).unwrap();
        let note_dir = dir.join("vaultid");
        assert!(note_dir.join(format!("{ID}.json")).exists());
        assert!(!note_dir.join(format!("{ID}.json.tmp")).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_is_idempotent() {
        let dir = temp_dir();
        assert!(remove_envelope(dir.to_str().unwrap(), "vaultid", ID).is_ok());
        write_envelope(dir.to_str().unwrap(), &envelope(), "vaultid", ID).unwrap();
        assert!(remove_envelope(dir.to_str().unwrap(), "vaultid", ID).is_ok());
        assert!(read_envelope(dir.to_str().unwrap(), "vaultid", ID).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_envelope_is_none() {
        assert!(read_envelope("/nonexistent", "v", ID).is_none());
    }
}
