use std::sync::Mutex;

use rusqlite::{Connection, params};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }
}

pub fn open(data_dir: &str) -> Result<Database, Box<dyn std::error::Error>> {
    std::fs::create_dir_all(data_dir)?;
    let conn = Connection::open(format!("{data_dir}/folio.db"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA busy_timeout=5000;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS items (
            vault_id TEXT NOT NULL,
            id TEXT NOT NULL,
            rev INTEGER NOT NULL,
            PRIMARY KEY (vault_id, id)
        );
        CREATE TABLE IF NOT EXISTS shares (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            has_password INTEGER NOT NULL,
            salt TEXT,
            wrapped_key TEXT,
            verifier TEXT,
            expires_at INTEGER,
            max_views INTEGER,
            view_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shares_note_id ON shares(note_id);",
    )?;
    Ok(Database::new(conn))
}

#[cfg(test)]
pub fn get_rev(db: &Database, vault_id: &str, id: &str) -> Option<i64> {
    let conn = db.lock();
    conn.prepare("SELECT rev FROM items WHERE vault_id = ?1 AND id = ?2")
        .ok()?
        .query_row(params![vault_id, id], |row| row.get::<_, i64>(0))
        .ok()
}

pub fn get_manifest(db: &Database, vault_id: &str) -> Result<Vec<(String, i64)>, rusqlite::Error> {
    let conn = db.lock();
    let mut stmt = conn.prepare("SELECT id, rev FROM items WHERE vault_id = ?1 ORDER BY id")?;
    let rows = stmt.query_map(params![vault_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
}

pub fn vacuum_into(db: &Database, path: &str) -> Result<(), rusqlite::Error> {
    let conn = db.lock();
    conn.execute("VACUUM INTO ?1", params![path])?;
    Ok(())
}

pub fn insert_item(
    db: &Database,
    vault_id: &str,
    id: &str,
) -> Result<Option<i64>, rusqlite::Error> {
    let conn = db.lock();
    let rows = conn.execute(
        "INSERT OR IGNORE INTO items (vault_id, id, rev) VALUES (?1, ?2, 1)",
        params![vault_id, id],
    )?;
    Ok((rows == 1).then_some(1))
}

pub fn advance_item(
    db: &Database,
    vault_id: &str,
    id: &str,
    base_rev: i64,
) -> Result<Option<i64>, rusqlite::Error> {
    let conn = db.lock();
    let new_rev = base_rev + 1;
    let rows = conn.execute(
        "UPDATE items SET rev = ?3 WHERE vault_id = ?1 AND id = ?2 AND rev = ?4",
        params![vault_id, id, new_rev, base_rev],
    )?;
    Ok((rows == 1).then_some(new_rev))
}

#[derive(Debug, Clone)]
pub struct ShareRecord {
    pub id: String,
    pub note_id: String,
    pub has_password: bool,
    pub salt: Option<String>,
    pub wrapped_key: Option<String>,
    pub verifier: Option<String>,
    pub expires_at: Option<i64>,
    pub max_views: Option<i64>,
    pub view_count: i64,
    pub created_at: i64,
}

pub fn insert_share(db: &Database, share: &ShareRecord) -> Result<(), rusqlite::Error> {
    let conn = db.lock();
    conn.execute(
        "INSERT OR REPLACE INTO shares (id, note_id, has_password, salt, wrapped_key, verifier, expires_at, max_views, view_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            share.id,
            share.note_id,
            share.has_password as i32,
            share.salt,
            share.wrapped_key,
            share.verifier,
            share.expires_at,
            share.max_views,
            share.view_count,
            share.created_at,
        ],
    )?;
    Ok(())
}

pub fn get_share(db: &Database, id: &str) -> Result<Option<ShareRecord>, rusqlite::Error> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, note_id, has_password, salt, wrapped_key, verifier, expires_at, max_views, view_count, created_at
         FROM shares WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(ShareRecord {
            id: row.get(0)?,
            note_id: row.get(1)?,
            has_password: row.get::<_, i32>(2)? != 0,
            salt: row.get(3)?,
            wrapped_key: row.get(4)?,
            verifier: row.get(5)?,
            expires_at: row.get(6)?,
            max_views: row.get(7)?,
            view_count: row.get(8)?,
            created_at: row.get(9)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn get_share_by_note(db: &Database, note_id: &str) -> Result<Option<ShareRecord>, rusqlite::Error> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, note_id, has_password, salt, wrapped_key, verifier, expires_at, max_views, view_count, created_at
         FROM shares WHERE note_id = ?1 ORDER BY created_at DESC LIMIT 1",
    )?;
    let mut rows = stmt.query(params![note_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(ShareRecord {
            id: row.get(0)?,
            note_id: row.get(1)?,
            has_password: row.get::<_, i32>(2)? != 0,
            salt: row.get(3)?,
            wrapped_key: row.get(4)?,
            verifier: row.get(5)?,
            expires_at: row.get(6)?,
            max_views: row.get(7)?,
            view_count: row.get(8)?,
            created_at: row.get(9)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn increment_share_view(db: &Database, id: &str) -> Result<i64, rusqlite::Error> {
    let conn = db.lock();
    conn.execute(
        "UPDATE shares SET view_count = view_count + 1 WHERE id = ?1",
        params![id],
    )?;
    let mut stmt = conn.prepare("SELECT view_count FROM shares WHERE id = ?1")?;
    stmt.query_row(params![id], |row| row.get(0))
}

pub fn delete_share(db: &Database, id: &str) -> Result<bool, rusqlite::Error> {
    let conn = db.lock();
    let rows = conn.execute("DELETE FROM shares WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    fn temp_db() -> (Database, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("folio-db-test-{}", uuid::Uuid::new_v4()));
        let db = open(dir.to_str().unwrap()).unwrap();
        (db, dir)
    }

    #[test]
    fn insert_advance_with_conflicts() {
        let (db, dir) = temp_db();
        assert_eq!(insert_item(&db, "v", ID).unwrap(), Some(1));
        assert_eq!(insert_item(&db, "v", ID).unwrap(), None);
        assert_eq!(advance_item(&db, "v", ID, 1).unwrap(), Some(2));
        assert_eq!(advance_item(&db, "v", ID, 1).unwrap(), None);
        assert!(get_rev(&db, "v", ID).unwrap() == 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn vaults_are_isolated() {
        let (db, dir) = temp_db();
        insert_item(&db, "vault-a", ID).unwrap();
        assert!(get_rev(&db, "vault-b", ID).is_none());
        assert_eq!(get_manifest(&db, "vault-a").unwrap().len(), 1);
        assert!(get_manifest(&db, "vault-b").unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn manifest_reports_rev() {
        let (db, dir) = temp_db();
        insert_item(&db, "v", ID).unwrap();
        advance_item(&db, "v", ID, 1).unwrap();
        let row = &get_manifest(&db, "v").unwrap()[0];
        assert_eq!(row.0, ID);
        assert_eq!(row.1, 2);
        std::fs::remove_dir_all(&dir).ok();
    }
}
