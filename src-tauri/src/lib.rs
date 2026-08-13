mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init());
    #[cfg(not(mobile))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::secret_get,
        commands::secret_set,
        commands::secret_delete,
        commands::pick_vault_folder,
        commands::grant_vault_scope
    ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::secret_get,
        commands::secret_set,
        commands::secret_delete
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running folio");
}
