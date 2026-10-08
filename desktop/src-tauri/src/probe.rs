// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Vérifie qu'une adresse mène bien à un serveur ReView avant d'ouvrir quoi que ce soit.
//!
//! La vérification passe par Rust et non par le lanceur : depuis le webview, un `fetch`
//! vers le serveur serait bloqué par CORS (le backend n'autorise que sa propre origine).
//! Deux routes publiques suffisent, et aucune n'a été ajoutée au serveur pour l'occasion —
//! n'importe quelle version déjà déployée répond :
//!
//! - `GET /api/version` identifie ReView (`version`, `source`) ;
//! - `GET /api/studio/branding` donne le nom du studio, à titre d'agrément.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::server_url::ServerAddress;

const TIMEOUT: Duration = Duration::from_secs(8);

/// Ce que le lanceur affiche d'un serveur vérifié.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub origin: String,
    pub host: String,
    pub secure: bool,
    pub version: String,
    pub studio_name: Option<String>,
}

/// Échec d'une vérification. `code` est traduit par l'interface ; `detail` reste en
/// anglais technique (message de la pile réseau) et ne s'affiche qu'en complément.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProbeError {
    pub code: &'static str,
    pub detail: Option<String>,
}

impl ProbeError {
    fn new(code: &'static str, detail: impl Into<Option<String>>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

#[derive(Deserialize)]
struct VersionBody {
    version: String,
}

#[derive(Deserialize)]
struct BrandingBody {
    name: Option<String>,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("ReView-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("client HTTP : configuration statique invalide")
}

/// Interroge le serveur. Échoue si `/api/version` ne répond pas comme ReView ; le nom du
/// studio, lui, est facultatif.
pub async fn probe(client: &reqwest::Client, address: &ServerAddress) -> Result<ServerInfo, ProbeError> {
    let response = client
        .get(format!("{}/api/version", address.origin))
        .send()
        .await
        .map_err(|e| classify(&e))?;
    let status = response.status();
    if !status.is_success() {
        // Un 404 sur cette route, c'est un serveur web qui n'est pas ReView.
        let code = if status == reqwest::StatusCode::NOT_FOUND {
            "not_review"
        } else {
            "http_status"
        };
        return Err(ProbeError::new(code, status.as_u16().to_string()));
    }
    let body: VersionBody = response
        .json()
        .await
        .map_err(|_| ProbeError::new("not_review", None))?;
    if body.version.trim().is_empty() {
        return Err(ProbeError::new("not_review", None));
    }

    let studio_name = match client
        .get(format!("{}/api/studio/branding", address.origin))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r
            .json::<BrandingBody>()
            .await
            .ok()
            .and_then(|b| b.name)
            .map(|n| n.trim().to_owned())
            .filter(|n| !n.is_empty()),
        _ => None,
    };

    Ok(ServerInfo {
        origin: address.origin.clone(),
        host: address.host.clone(),
        secure: address.secure,
        version: body.version,
        studio_name,
    })
}

/// Range une erreur réseau dans une catégorie que l'utilisateur peut corriger.
fn classify(error: &reqwest::Error) -> ProbeError {
    let detail = Some(chain(error));
    if error.is_timeout() {
        return ProbeError::new("timeout", detail);
    }
    // On cherche le type de l'erreur TLS dans la chaîne, pas des mots dans son message :
    // SChannel rédige les siens dans la langue du système (« Le jeton fourni à la fonction
    // n'est pas valide » pour un serveur qui ne parle pas HTTPS).
    if is_tls(error) {
        return ProbeError::new("tls", detail);
    }
    ProbeError::new("unreachable", detail)
}

fn is_tls(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(e) = current {
        if e.downcast_ref::<native_tls::Error>().is_some() {
            return true;
        }
        current = e.source();
    }
    false
}

fn chain(error: &dyn std::error::Error) -> String {
    let mut out = error.to_string();
    let mut source = error.source();
    while let Some(s) = source {
        out.push_str(": ");
        out.push_str(&s.to_string());
        source = s.source();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server_url::parse;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread;

    /// Petit serveur HTTP qui répond selon le chemin demandé, le temps du test.
    fn serve(routes: &'static [(&'static str, u16, &'static str)]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let path = line.split_whitespace().nth(1).unwrap_or("/").to_owned();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap() <= 2 {
                        break;
                    }
                }
                let (status, body) = routes
                    .iter()
                    .find(|(p, _, _)| *p == path)
                    .map(|(_, s, b)| (*s, *b))
                    .unwrap_or((404, "<h1>Not found</h1>"));
                let mut stream = stream;
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn reconnait_un_serveur_review_et_son_studio() {
        let base = serve(&[
            (
                "/api/version",
                200,
                r#"{"version":"2.0.0","source":"https://github.com/YvigUnderscore/ReView"}"#,
            ),
            (
                "/api/studio/branding",
                200,
                r#"{"name":"  Studio Durian  ","accent":null}"#,
            ),
        ]);
        let info = probe(&client(), &parse(&base).unwrap()).await.unwrap();
        assert_eq!(info.version, "2.0.0");
        assert_eq!(info.studio_name.as_deref(), Some("Studio Durian"));
        assert!(!info.secure);
    }

    #[tokio::test]
    async fn le_nom_du_studio_est_facultatif() {
        let base = serve(&[("/api/version", 200, r#"{"version":"1.4.0"}"#)]);
        let info = probe(&client(), &parse(&base).unwrap()).await.unwrap();
        assert_eq!(info.studio_name, None);
    }

    #[tokio::test]
    async fn un_autre_serveur_web_n_est_pas_review() {
        let base = serve(&[("/", 200, "<html></html>")]);
        let err = probe(&client(), &parse(&base).unwrap()).await.unwrap_err();
        assert_eq!(err.code, "not_review");

        let base = serve(&[("/api/version", 200, "<!doctype html><html></html>")]);
        let err = probe(&client(), &parse(&base).unwrap()).await.unwrap_err();
        assert_eq!(err.code, "not_review");
    }

    #[tokio::test]
    async fn une_erreur_serveur_n_est_pas_confondue_avec_une_absence() {
        let base = serve(&[("/api/version", 502, "{}")]);
        let err = probe(&client(), &parse(&base).unwrap()).await.unwrap_err();
        assert_eq!(err.code, "http_status");
        assert_eq!(err.detail.as_deref(), Some("502"));
    }

    #[tokio::test]
    async fn un_serveur_sans_https_est_un_echec_tls() {
        // Le serveur de test ne parle que HTTP en clair : la poignée de main TLS échoue.
        let base = serve(&[("/api/version", 200, r#"{"version":"2.0.0"}"#)]);
        let https = base.replacen("http://", "https://", 1);
        let err = probe(&client(), &parse(&https).unwrap()).await.unwrap_err();
        assert_eq!(err.code, "tls");
    }

    #[tokio::test]
    async fn un_port_ferme_est_injoignable() {
        // Port réservé puis relâché : plus personne n'écoute derrière.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let err = probe(&client(), &parse(&format!("http://127.0.0.1:{port}")).unwrap())
            .await
            .unwrap_err();
        assert_eq!(err.code, "unreachable");
        assert!(err.detail.is_some());
    }
}
