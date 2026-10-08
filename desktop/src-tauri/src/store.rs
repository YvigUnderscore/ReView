// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Liste des serveurs connus — la seule chose que le mode serveur écrit sur le disque.
//!
//! Elle tient dans un fichier JSON du dossier de configuration de l'application : adresse,
//! nom du studio, version vue, dates. Ni session, ni jeton, ni média : la fenêtre d'un
//! serveur est privée (voir `windows.rs`) et ne laisse rien derrière elle. Un serveur n'y
//! entre qu'une fois vérifié, jamais sur simple saisie.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::probe::ServerInfo;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedServer {
    pub origin: String,
    pub host: String,
    pub secure: bool,
    pub version: String,
    pub studio_name: Option<String>,
    /// Secondes depuis l'époque Unix.
    pub added_at: u64,
    pub last_opened_at: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreFile {
    servers: Vec<SavedServer>,
}

pub struct ServerStore {
    path: PathBuf,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl ServerStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("servers.json"),
        }
    }

    /// Serveurs du plus récemment ouvert au plus ancien. Un fichier absent ou illisible
    /// donne une liste vide : perdre la liste ne doit pas empêcher l'application de s'ouvrir.
    pub fn list(&self) -> Vec<SavedServer> {
        let mut servers = fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoreFile>(&bytes).ok())
            .map(|f| f.servers)
            .unwrap_or_default();
        servers.sort_by_key(|s| std::cmp::Reverse(s.last_opened_at.unwrap_or(s.added_at)));
        servers
    }

    /// Ajoute ou met à jour (même origine) un serveur vérifié.
    pub fn upsert(&self, info: &ServerInfo) -> io::Result<SavedServer> {
        let mut servers = self.list();
        let saved = match servers.iter_mut().find(|s| s.origin == info.origin) {
            Some(existing) => {
                existing.version = info.version.clone();
                existing.studio_name = info.studio_name.clone();
                existing.secure = info.secure;
                existing.clone()
            }
            None => {
                let s = SavedServer {
                    origin: info.origin.clone(),
                    host: info.host.clone(),
                    secure: info.secure,
                    version: info.version.clone(),
                    studio_name: info.studio_name.clone(),
                    added_at: now(),
                    last_opened_at: None,
                };
                servers.push(s.clone());
                s
            }
        };
        self.write(&servers)?;
        Ok(saved)
    }

    pub fn touch(&self, origin: &str) -> io::Result<Option<SavedServer>> {
        let mut servers = self.list();
        let found = servers.iter_mut().find(|s| s.origin == origin).map(|s| {
            s.last_opened_at = Some(now());
            s.clone()
        });
        if found.is_some() {
            self.write(&servers)?;
        }
        Ok(found)
    }

    pub fn remove(&self, origin: &str) -> io::Result<()> {
        let servers: Vec<_> = self.list().into_iter().filter(|s| s.origin != origin).collect();
        self.write(&servers)
    }

    /// Écriture atomique : un arrêt brutal laisse l'ancienne liste, jamais une moitié.
    fn write(&self, servers: &[SavedServer]) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let body = serde_json::to_vec_pretty(&StoreFile {
            servers: servers.to_vec(),
        })
        .map_err(io::Error::other)?;
        fs::write(&tmp, body)?;
        fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn temp_store() -> (ServerStore, PathBuf) {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "review-desktop-store-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        (ServerStore::new(&dir), dir)
    }

    fn info(origin: &str, version: &str) -> ServerInfo {
        ServerInfo {
            origin: origin.into(),
            host: origin.trim_start_matches("https://").into(),
            secure: true,
            version: version.into(),
            studio_name: Some("Durian".into()),
        }
    }

    #[test]
    fn une_liste_absente_est_vide() {
        let (store, dir) = temp_store();
        assert!(store.list().is_empty());
        assert!(!dir.exists(), "lire ne doit rien créer sur le disque");
    }

    #[test]
    fn un_fichier_corrompu_ne_bloque_pas_l_application() {
        let (store, dir) = temp_store();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("servers.json"), b"{ pas du json").unwrap();
        assert!(store.list().is_empty());
        store.upsert(&info("https://a.fr", "2.0.0")).unwrap();
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn meme_origine_met_a_jour_sans_doublon() {
        let (store, _) = temp_store();
        store.upsert(&info("https://a.fr", "2.0.0")).unwrap();
        let updated = store.upsert(&info("https://a.fr", "2.1.0")).unwrap();
        assert_eq!(updated.version, "2.1.0");
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn le_dernier_ouvert_passe_en_tete_et_le_retrait_est_definitif() {
        let (store, dir) = temp_store();
        store.upsert(&info("https://a.fr", "2.0.0")).unwrap();
        store.upsert(&info("https://b.fr", "2.0.0")).unwrap();
        assert!(store.touch("https://a.fr").unwrap().is_some());
        assert_eq!(store.list()[0].origin, "https://a.fr");
        assert!(store.touch("https://inconnu.fr").unwrap().is_none());

        store.remove("https://a.fr").unwrap();
        let left: Vec<_> = store.list().into_iter().map(|s| s.origin).collect();
        assert_eq!(left, ["https://b.fr"]);
        assert!(!dir.join("servers.json.tmp").exists());
    }

    #[test]
    fn le_fichier_ne_contient_que_des_adresses_et_des_dates() {
        let (store, dir) = temp_store();
        store.upsert(&info("https://a.fr", "2.0.0")).unwrap();
        let raw = fs::read_to_string(dir.join("servers.json")).unwrap();
        let mut keys: Vec<_> = serde_json::from_str::<serde_json::Value>(&raw).unwrap()["servers"][0]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "addedAt",
                "host",
                "lastOpenedAt",
                "origin",
                "secure",
                "studioName",
                "version"
            ]
        );
    }
}
