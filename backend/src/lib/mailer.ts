// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from './logger';
import { htmlToText } from './mailText';
import { getEffectiveConfig, type SmtpEffectiveConfig } from '../services/SmtpService';

/**
 * Envoi d'emails (invitation, digest quotidien, rapport hebdomadaire, test SMTP).
 * Configuration lue via `SmtpService` (base chiffrée + override environnement). Sans
 * host configuré, aucun envoi n'est tenté.
 */

/** Vrai si un serveur SMTP est configuré (base ou environnement). */
export async function isMailerConfigured(): Promise<boolean> {
  return (await getEffectiveConfig()) !== null;
}

/**
 * Transport nodemailer du relais configuré.
 *
 * `requireTLS` n'est pas un détail de confort : sans lui, le STARTTLS du mode 587 est
 * OPPORTUNISTE. Un intermédiaire réseau qui retire `250-STARTTLS` de la réponse EHLO fait
 * poursuivre le dialogue en clair — nodemailer envoie alors `AUTH LOGIN` (identifiants du
 * studio) puis le corps du message. Or le message le plus sensible d'ici est l'invitation :
 * son jeton pose le mot de passe d'un compte. Avec `requireTLS`, la connexion est
 * abandonnée au lieu d'être dégradée.
 *
 * `secure: true` (port 465) chiffre déjà d'emblée : `requireTLS` n'y a pas de sens.
 * `allowInsecure` est l'échappatoire assumée du relais interne sans certificat.
 */
function buildTransport(cfg: SmtpEffectiveConfig): Transporter {
  if (cfg.allowInsecure) warnInsecureOnce(cfg.host);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && !cfg.allowInsecure,
    // TLS 1.0/1.1 sont retirés partout ailleurs ; les laisser ici rouvrirait la
    // dégradation par le bas plutôt que par la suppression de STARTTLS.
    tls: { minVersion: 'TLSv1.2' },
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
  });
}

let insecureWarned = false;

/** Une seule ligne par process : le réglage est délibéré, mais il ne doit pas s'oublier. */
function warnInsecureOnce(host: string): void {
  if (insecureWarned) return;
  insecureWarned = true;
  logger.warn(
    { host },
    '[mailer] dialogue SMTP en clair autorisé (allowInsecure) : identifiants et liens d’invitation circulent sans chiffrement.',
  );
}

export interface MailOptions {
  /**
   * Adresse de désabonnement d'un envoi récurrent (digest, rapport hebdomadaire).
   * Elle produit l'en-tête `List-Unsubscribe`, que les messageries transforment en
   * bouton natif « Se désabonner ». Sans lui, le lecteur qui ne veut plus du digest
   * n'a qu'un geste à sa portée : marquer le message comme indésirable — ce qui abîme
   * la réputation du serveur pour TOUS les envois du studio, invitations comprises.
   */
  unsubscribeUrl?: string;
  /** Texte brut, quand le message en a une meilleure version que celle dérivée du HTML. */
  text?: string;
}

/**
 * Envoie un message. Le corps part toujours en deux versions : le HTML et son
 * équivalent texte.
 *
 * Nous n'envoyions que du HTML. Les filtres anti-spam pénalisent un message sans
 * alternative texte ; les aperçus (liste de la boîte, notification de montre, lecteur
 * d'écran) y affichaient du balisage brut ; un client en mode texte ne montrait rien.
 */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
  options: MailOptions = {},
): Promise<boolean> {
  const cfg = await getEffectiveConfig();
  if (!cfg) return false;
  try {
    await buildTransport(cfg).sendMail({
      from: cfg.from,
      to,
      subject,
      html,
      text: options.text ?? htmlToText(html),
      headers: {
        /**
         * Message émis par une machine, pas par une personne.
         *
         * Sans ces deux en-têtes, un répondeur d'absence répond au digest ; l'adresse
         * d'expédition du studio reçoit la réponse, et selon la configuration du relais
         * la boucle peut se refermer. Ils ne coûtent rien et coupent le cas net.
         */
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        ...(options.unsubscribeUrl
          ? {
              'List-Unsubscribe': `<${options.unsubscribeUrl}>`,
              // Déclare que le désabonnement se fait en un appel, sans page de
              // confirmation : sans cet en-tête, Gmail et Outlook n'affichent pas le
              // bouton natif.
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : {}),
      },
    });
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, '[Mailer] échec d’envoi');
    return false;
  }
}
