#[cfg(not(mobile))]
use tauri_plugin_dialog::{DialogExt, FilePath};
#[cfg(not(mobile))]
use tauri_plugin_fs::FsExt;

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
