#[cfg(not(mobile))]
use tauri_plugin_dialog::{DialogExt, FilePath};
#[cfg(not(mobile))]
use tauri_plugin_fs::FsExt;

const KEYRING_SERVICE: &str = "com.vzpyr.folio";

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod keyring_backend {
    use super::KEYRING_SERVICE;
    use keyring::Entry;

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        Entry::new(KEYRING_SERVICE, key)
            .and_then(|e| e.set_password(value))
            .map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match Entry::new(KEYRING_SERVICE, key) {
            Ok(e) => e.delete_credential().map_err(|e| e.to_string()),
            Err(_) => Ok(()),
        }
    }
}

#[cfg(any(target_os = "ios", target_os = "android"))]
mod keyring_backend {
    use std::sync::{Arc, OnceLock};

    use keyring_core::Entry;

    #[cfg(target_os = "android")]
    #[used]
    static KEEP_KEYRING_JNI: extern "system" fn(
        jni::JNIEnv<'static>,
        jni::objects::JObject,
        jni::objects::JObject,
    ) = android_native_keyring_store::Java_io_crates_keyring_Keyring_00024Companion_initializeNdkContext;

    fn ensure_store() -> Result<(), String> {
        static STORE: OnceLock<Result<Arc<keyring_core::CredentialStore>, String>> =
            OnceLock::new();

        STORE
            .get_or_init(|| {
                let store: Arc<keyring_core::CredentialStore> = new_store()?;
                keyring_core::set_default_store(store.clone());
                Ok(store)
            })
            .as_ref()
            .map(|_| ())
            .map_err(|e| e.clone())
    }

    #[cfg(target_os = "ios")]
    fn new_store() -> Result<Arc<keyring_core::CredentialStore>, String> {
        let store: Arc<keyring_core::CredentialStore> =
            apple_native_keyring_store::protected::Store::new().map_err(|e| e.to_string())?;
        Ok(store)
    }

    #[cfg(target_os = "android")]
    fn new_store() -> Result<Arc<keyring_core::CredentialStore>, String> {
        let store: Arc<keyring_core::CredentialStore> =
            android_native_keyring_store::by_store::Store::new().map_err(|e| e.to_string())?;
        Ok(store)
    }

    fn entry(key: &str) -> Result<Entry, String> {
        ensure_store()?;
        Entry::new(super::KEYRING_SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(key: &str) -> Result<(), String> {
        entry(key)?.delete_credential().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    keyring_backend::get(&key)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring_backend::set(&key, &value)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    keyring_backend::delete(&key)
}

#[cfg(test)]
mod tests {
    use super::keyring_backend;

    #[test]
    fn keyring_roundtrip() {
        let key = format!("folio:test:{}:secret", std::process::id());
        match keyring_backend::set(&key, "s3cr3t") {
            Ok(()) => {
                assert_eq!(
                    keyring_backend::get(&key).unwrap(),
                    Some("s3cr3t".to_string())
                );
                keyring_backend::delete(&key).unwrap();
                assert_eq!(keyring_backend::get(&key).unwrap(), None);
            }
            Err(e) => {
                eprintln!("skipping keyring roundtrip (no backend available): {e}");
            }
        }
    }
}

#[cfg(not(mobile))]
#[tauri::command]
pub async fn pick_vault_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = rx
        .await
        .map_err(|_| "folder picker closed unexpectedly".to_string())?
        .map(path_to_string);
    Ok(picked)
}

#[cfg(not(mobile))]
#[tauri::command]
pub fn grant_vault_scope(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let dir_path = std::path::Path::new(&dir);
    app.fs_scope()
        .allow_directory(dir_path, true)
        .map_err(|e| format!("could not grant access to folder: {e}"))?;
    app.fs_scope()
        .allow_directory(dir_path.join(".folio"), true)
        .map_err(|e| format!("could not grant access to .folio: {e}"))?;
    Ok(())
}

#[cfg(not(mobile))]
fn path_to_string(p: FilePath) -> String {
    match p {
        FilePath::Path(p) => p.to_string_lossy().to_string(),
        FilePath::Url(u) => u.to_string(),
    }
}
