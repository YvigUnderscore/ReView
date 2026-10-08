// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fenêtres de l'application : le lanceur, et une fenêtre par serveur ouvert.
//!
//! Une fenêtre de serveur charge l'origine du serveur elle-même — pas un frontend local qui
//! l'appellerait de loin : les URL relatives du frontend (`/api`, `/socket.io`) visent
//! alors naturellement le bon serveur, sans CORS ni configuration. Elle est **privée**
//! (`incognito`) : cookies, stockage local et cache vivent en mémoire et disparaissent à la
//! fermeture. C'est ce qui permet de dire « rien sur ce disque » sans mentir — la session,
//! en contrepartie, ne survit pas à la fenêtre.
//!
//! Le mode du projet se lit dans le titre de la fenêtre, toujours visible ; la page du
//! serveur ne peut pas le réécrire (Tauri ne recopie pas `document.title`).
//!
//! L'autoremplissage de WebView2 est coupé partout : il retenait sur le disque ce qu'on
//! tapait dans un champ, même `autocomplete="off"` — y compris une adresse refusée.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

pub const LAUNCHER: &str = "main";
pub const DIAGNOSTIC: &str = "diagnostic";
pub const NOTICES: &str = "notices";
const SERVER_PREFIX: &str = "server-";

/// Étiquette stable d'une origine : rouvrir un serveur déjà ouvert ramène sa fenêtre au
/// premier plan au lieu d'en créer une seconde. Les étiquettes Tauri n'admettent qu'un
/// alphabet restreint, d'où l'empreinte plutôt que l'origine brute.
pub fn server_label(origin: &str) -> String {
    let mut h = DefaultHasher::new();
    origin.hash(&mut h);
    format!("{SERVER_PREFIX}{:016x}", h.finish())
}

pub fn is_server(label: &str) -> bool {
    label.starts_with(SERVER_PREFIX)
}

/// Que faire d'un lien qui demande une nouvelle fenêtre (`target=_blank`, `window.open`) ?
#[derive(Debug, PartialEq, Eq)]
pub enum NewWindow {
    /// Même serveur : la page reste dans l'application.
    Stay,
    /// Site extérieur : le navigateur du système, hors de la fenêtre privée.
    Browser,
    /// `file:`, `javascript:`, protocole maison… : rien.
    Refuse,
}

pub fn new_window_policy(server_origin: &str, url: &Url) -> NewWindow {
    if url.origin().ascii_serialization() == server_origin {
        NewWindow::Stay
    } else if matches!(url.scheme(), "http" | "https" | "mailto") {
        NewWindow::Browser
    } else {
        NewWindow::Refuse
    }
}

/// Titre de la fenêtre d'un serveur : qui, où, et le mode — le « badge permanent » de la
/// spécification. `badge` arrive traduit du lanceur.
pub fn server_title(studio: Option<&str>, host: &str, badge: &str) -> String {
    match studio {
        Some(name) => format!("{name} ({host}) — {badge}"),
        None => format!("{host} — {badge}"),
    }
}

pub fn open_server<R: Runtime>(app: &AppHandle<R>, origin: &str, title: &str) -> Result<(), String> {
    let label = server_label(origin);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        existing.set_focus().map_err(|e| e.to_string())?;
    } else {
        let url = origin.parse().map_err(|e: url::ParseError| e.to_string())?;
        let server_origin = origin.to_owned();
        let handle = app.clone();
        WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title(title)
            .inner_size(1440.0, 900.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .incognito(true)
            .general_autofill_enabled(false)
            .on_new_window(move |url, _| match new_window_policy(&server_origin, &url) {
                NewWindow::Stay => NewWindowResponse::Allow,
                NewWindow::Browser => {
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                }
                NewWindow::Refuse => NewWindowResponse::Deny,
            })
            .build()
            .map_err(|e| e.to_string())?;
    }
    // Le lanceur s'efface tant qu'un serveur est ouvert ; il revient à la dernière fermeture.
    if let Some(launcher) = app.get_webview_window(LAUNCHER) {
        let _ = launcher.hide();
    }
    Ok(())
}

/// Ouvre (ou ramène) une fenêtre servant une page embarquée : diagnostic, licences.
pub fn open_bundled<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    path: &str,
    title: &str,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(label) {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(path.into()))
        .title(title)
        .inner_size(1180.0, 820.0)
        .general_autofill_enabled(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Appelé à la destruction d'une fenêtre : la dernière fenêtre de serveur fermée rend la
/// main au lanceur, sinon l'application tournerait sans fenêtre visible.
pub fn on_destroyed<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if !is_server(label) {
        return;
    }
    let others = app.webview_windows().keys().any(|l| l != label && is_server(l));
    if !others {
        if let Some(launcher) = app.get_webview_window(LAUNCHER) {
            let _ = launcher.show();
            let _ = launcher.set_focus();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_origine_donne_toujours_la_meme_etiquette_valide() {
        let a = server_label("https://review.studio.fr");
        assert_eq!(a, server_label("https://review.studio.fr"));
        assert_ne!(a, server_label("https://autre.studio.fr"));
        assert!(is_server(&a));
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        assert!(!is_server(LAUNCHER) && !is_server(DIAGNOSTIC) && !is_server(NOTICES));
    }

    #[test]
    fn un_lien_exterieur_part_dans_le_navigateur() {
        let o = "https://review.studio.fr";
        let u = |s: &str| Url::parse(s).unwrap();
        assert_eq!(
            new_window_policy(o, &u("https://review.studio.fr/shots/12")),
            NewWindow::Stay
        );
        assert_eq!(
            new_window_policy(o, &u("https://github.com/YvigUnderscore/ReView")),
            NewWindow::Browser
        );
        assert_eq!(
            new_window_policy(o, &u("mailto:prod@studio.fr")),
            NewWindow::Browser
        );
        // Même hôte, autre port ou autre schéma : une autre origine.
        assert_eq!(
            new_window_policy(o, &u("http://review.studio.fr/")),
            NewWindow::Browser
        );
        assert_eq!(
            new_window_policy(o, &u("file:///C:/Windows/system32/calc.exe")),
            NewWindow::Refuse
        );
        assert_eq!(new_window_policy(o, &u("ms-settings:privacy")), NewWindow::Refuse);
    }

    #[test]
    fn le_titre_porte_le_mode() {
        assert_eq!(
            server_title(Some("Durian"), "review.fr", "Serveur · rien sur ce disque"),
            "Durian (review.fr) — Serveur · rien sur ce disque"
        );
        assert_eq!(server_title(None, "10.0.0.2", "Server"), "10.0.0.2 — Server");
    }
}
