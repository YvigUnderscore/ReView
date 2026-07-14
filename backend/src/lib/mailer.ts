import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from './logger';
import { getEffectiveConfig, type SmtpEffectiveConfig } from '../services/SmtpService';

/**
 * Envoi d'emails (digest quotidien, test SMTP). Configuration lue via `SmtpService`
 * (base chiffrée + override environnement). Sans host configuré, aucun envoi n'est tenté.
 */

/** Vrai si un serveur SMTP est configuré (base ou environnement). */
export async function isMailerConfigured(): Promise<boolean> {
  return (await getEffectiveConfig()) !== null;
}

function buildTransport(cfg: SmtpEffectiveConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
  });
}

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = await getEffectiveConfig();
  if (!cfg) return false;
  try {
    await buildTransport(cfg).sendMail({ from: cfg.from, to, subject, html });
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, '[Mailer] échec d’envoi');
    return false;
  }
}
