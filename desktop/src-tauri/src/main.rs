// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

//! ReView Desktop.
//!
//! Version 0.2 (alpha) : le mode **serveur** — l'application ouvre un serveur ReView existant
//! dans une fenêtre privée et n'écrit sur le disque que la liste des adresses connues. Les
//! modes autonome et « rejoindre un projet » (pair-à-pair) sont annoncés par le lanceur mais
//! pas encore livrés.
//!
//! Le lanceur (`desktop/launcher`) est une page embarquée ; il ne parle qu'à ces commandes.
//! Leur liste est déclarée dans `build.rs` et accordée par fenêtre (`capabilities/`) : une
//! fenêtre de serveur, qui affiche du contenu distant, n'en reçoit aucune.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod probe;
mod server_url;
mod store;
mod windows;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use crate::probe::ProbeError;
use crate::store::{SavedServer, ServerStore};

const SOURCE_URL: &str = "https://github.com/YvigUnderscore/ReView";

struct AppState {
    store: ServerStore,
    http: reqwest::Client,
}

/// Erreur renvoyée au lanceur : un code qu'il traduit, un détail technique facultatif.
#[derive(Debug, Serialize)]
struct CommandError {
    code: String,
    detail: Option<String>,
}

impl CommandError {
    fn new(code: &str, detail: impl Into<Option<String>>) -> Self {
        Self {
            code: code.to_owned(),
            detail: detail.into(),
        }
    }
}

impl From<ProbeError> for CommandError {
    fn from(e: ProbeError) -> Self {
        Self::new(e.code, e.detail)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: &'static str,
    tauri: &'static str,
    os: &'static str,
    arch: &'static str,
    source_url: &'static str,
}

/// Ce que le host sait de lui-même et que le webview ne peut pas deviner (diagnostic).
#[derive(Serialize)]
struct HostInfo {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
    tauri: &'static str,
    app: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        tauri: tauri::VERSION,
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        source_url: SOURCE_URL,
    }
}

#[tauri::command]
fn host_info() -> HostInfo {
    HostInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        family: std::env::consts::FAMILY,
        tauri: tauri::VERSION,
        app: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> Vec<SavedServer> {
    state.store.list()
}

/// Vérifie l'adresse, l'enregistre et ouvre sa fenêtre — dans cet ordre : rien ne s'écrit
/// tant que le serveur n'a pas répondu comme un serveur ReView.
#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    address: String,
    badge: String,
) -> Result<SavedServer, CommandError> {
    let address = server_url::parse(&address).map_err(|e| CommandError::new(e.code(), None))?;
    let info = probe::probe(&state.http, &address).await?;
    state
        .store
        .upsert(&info)
        .map_err(|e| CommandError::new("store", e.to_string()))?;
    let saved = state
        .store
        .touch(&info.origin)
        .map_err(|e| CommandError::new("store", e.to_string()))?
        .ok_or_else(|| CommandError::new("store", None))?;
    let badge: String = badge.chars().filter(|c| !c.is_control()).take(80).collect();
    let title = windows::server_title(saved.studio_name.as_deref(), &saved.host, &badge);
    windows::open_server(&app, &saved.origin, &title).map_err(|e| CommandError::new("window", e))?;
    Ok(saved)
}

#[tauri::command]
fn remove_server(state: State<'_, AppState>, origin: String) -> Result<(), CommandError> {
    state
        .store
        .remove(&origin)
        .map_err(|e| CommandError::new("store", e.to_string()))
}

/// La fenêtre du lanceur naît cachée et ne s'affiche qu'une fois peinte : pas de cadre
/// blanc au démarrage.
#[tauri::command]
fn launcher_ready(app: AppHandle) {
    if let Some(w) = app.get_webview_window(windows::LAUNCHER) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// Les commandes qui créent une fenêtre sont `async` : sous Windows, construire une fenêtre
// depuis une commande synchrone bloque la boucle d'événements (la fenêtre reste sur
// `about:blank` et l'application se fige).
#[tauri::command]
async fn open_diagnostic(app: AppHandle, title: String) -> Result<(), CommandError> {
    windows::open_bundled(&app, windows::DIAGNOSTIC, "probe/index.html", &title)
        .map_err(|e| CommandError::new("window", e))
}

#[tauri::command]
async fn open_notices(app: AppHandle, title: String) -> Result<(), CommandError> {
    windows::open_bundled(&app, windows::NOTICES, "legal/THIRD-PARTY-NOTICES.txt", &title)
        .map_err(|e| CommandError::new("window", e))
}

/// Liens externes, ouverts dans le navigateur par défaut. Le lanceur ne passe qu'un nom :
/// aucune URL arbitraire ne transite par cette commande.
#[tauri::command]
fn open_link(app: AppHandle, which: String) -> Result<(), CommandError> {
    // La documentation est lue à l'étiquette de cette version : elle décrit ce binaire-ci,
    // pas la branche du jour.
    let docs = format!(
        "{SOURCE_URL}/blob/desktop-v{}/DOCUMENTATION",
        env!("CARGO_PKG_VERSION")
    );
    let url = match which.as_str() {
        "source" => SOURCE_URL.to_owned(),
        "server_install" => format!("{docs}/getting-started/installation.md"),
        "desktop_guide" => format!("{docs}/getting-started/desktop-app.md"),
        _ => return Err(CommandError::new("link", which)),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| CommandError::new("link", e.to_string()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage(AppState {
                store: ServerStore::new(&dir),
                http: probe::client(),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                windows::on_destroyed(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            host_info,
            list_servers,
            connect,
            remove_server,
            launcher_ready,
            open_diagnostic,
            open_notices,
            open_link,
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de ReView Desktop");
}
