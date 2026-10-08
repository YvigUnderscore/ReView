// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Adresse d'un serveur ReView, telle qu'un utilisateur la tape.
//!
//! Le frontend de ReView parle à son backend en URL relatives à la racine (`/api`,
//! `/socket.io`) : un serveur se résume donc à une **origine** — schéma, hôte, port. Tout
//! chemin saisi est écarté plutôt que conservé, sans quoi la fenêtre ouvrirait une page
//! profonde dont les appels repartiraient de toute façon de la racine.

use url::Url;

/// Origine validée d'un serveur.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerAddress {
    /// `https://review.studio.fr` ou `http://192.168.1.20:3429` — jamais de `/` final.
    pub origin: String,
    pub host: String,
    /// Faux en `http://` : la connexion circule en clair, l'interface le signale.
    pub secure: bool,
}

/// Pourquoi une saisie n'est pas une adresse de serveur. Le code part tel quel vers
/// l'interface, qui le traduit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressError {
    Empty,
    Invalid,
    UnsupportedScheme,
    /// `https://moi:secret@serveur` : un mot de passe n'a rien à faire dans une adresse
    /// enregistrée en clair sur le disque.
    Credentials,
}

impl AddressError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Empty => "address_empty",
            Self::Invalid => "address_invalid",
            Self::UnsupportedScheme => "address_scheme",
            Self::Credentials => "address_credentials",
        }
    }
}

/// Normalise une saisie : `https://` par défaut, origine seule, hôte en minuscules.
pub fn parse(input: &str) -> Result<ServerAddress, AddressError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AddressError::Empty);
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| AddressError::Invalid)?;
    let secure = match url.scheme() {
        "https" => true,
        "http" => false,
        _ => return Err(AddressError::UnsupportedScheme),
    };
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AddressError::Credentials);
    }
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or(AddressError::Invalid)?;
    // `origin().ascii_serialization()` omet le port par défaut et passe l'hôte en
    // minuscules (et en punycode) : deux saisies du même serveur donnent la même clé.
    let origin = url.origin().ascii_serialization();
    Ok(ServerAddress {
        origin,
        host: host.to_owned(),
        secure,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ajoute_https_par_defaut() {
        let a = parse("review.studio.fr").unwrap();
        assert_eq!(a.origin, "https://review.studio.fr");
        assert!(a.secure);
    }

    #[test]
    fn garde_http_et_le_port_mais_le_signale() {
        let a = parse("http://192.168.1.20:3429").unwrap();
        assert_eq!(a.origin, "http://192.168.1.20:3429");
        assert_eq!(a.host, "192.168.1.20");
        assert!(!a.secure);
    }

    #[test]
    fn reduit_a_l_origine() {
        let a = parse("  HTTPS://Review.Studio.fr:443/projects/12?tab=shots#x  ").unwrap();
        assert_eq!(a.origin, "https://review.studio.fr");
    }

    #[test]
    fn refuse_ce_qui_n_est_pas_un_serveur_web() {
        assert_eq!(parse("   "), Err(AddressError::Empty));
        assert_eq!(parse("ftp://review.fr"), Err(AddressError::UnsupportedScheme));
        assert_eq!(parse("file:///C:/review"), Err(AddressError::UnsupportedScheme));
        assert_eq!(parse("https://"), Err(AddressError::Invalid));
        assert_eq!(parse("https://exa mple.fr"), Err(AddressError::Invalid));
    }

    #[test]
    fn refuse_un_mot_de_passe_dans_l_adresse() {
        assert_eq!(
            parse("https://moi:secret@review.fr"),
            Err(AddressError::Credentials)
        );
        assert_eq!(parse("https://moi@review.fr"), Err(AddressError::Credentials));
    }

    #[test]
    fn chaque_erreur_a_un_code_d_interface() {
        for e in [
            AddressError::Empty,
            AddressError::Invalid,
            AddressError::UnsupportedScheme,
            AddressError::Credentials,
        ] {
            assert!(e.code().starts_with("address_"));
        }
    }
}
