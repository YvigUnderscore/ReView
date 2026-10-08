// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Spike de validation du webview.
//!
//! Ce binaire ne fait rien d'autre qu'ouvrir une fenêtre. Il n'embarque ni backend, ni
//! Postgres, ni pair iroh : la seule question posée ici est de savoir si le webview
//! fourni par l'OS fait tourner le viewer de ReView — Three.js, Spark, hls.js. La
//! réponse conditionne toute l'architecture desktop, donc elle se mesure avant d'écrire
//! la moindre ligne de synchronisation.
//!
//! Deux cibles, selon la configuration passée au CLI (voir `desktop/README.md`) :
//!
//! - `tauri.conf.json` seul : la page de diagnostic statique (`desktop/probe`), qui
//!   interroge WebGL, les codecs et WASM sans aucun serveur.
//! - `--config tauri.app.conf.json` : le frontend réel servi par Vite, qui proxifie
//!   `/api` et `/socket.io` vers le backend. C'est le test grandeur réelle.
//!
//! Le binaire reste volontairement sans commande IPC : le frontend parle au backend en
//! HTTP sur `127.0.0.1` via des URL relatives (`/api/...`), exactement comme dans un
//! déploiement serveur. Rien à changer côté React, et le `postMessage` de Tauri reste
//! disponible plus tard pour ce que HTTP ne couvre pas (sélecteur de fichiers, veille).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

/// Ce que le host sait de lui-même et que le webview ne peut pas deviner.
///
/// La version du webview, elle, se lit mieux depuis la page (`navigator.userAgent`) :
/// c'est la chaîne que le moteur annonce réellement, pas celle que Rust croit charger.
#[derive(Serialize)]
struct HostInfo {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
    /// Version du crate `tauri` compilé dans ce binaire.
    tauri: &'static str,
    /// Version de ce spike, pour relier un rapport collé dans une issue à un build.
    app: &'static str,
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![host_info])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de la fenêtre ReView");
}
