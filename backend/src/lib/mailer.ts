import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Envoi d'emails (digest quotidien). Optionnel : sans SMTP_HOST configuré,
 * `isMailerConfigured()` renvoie false et aucun envoi n'est tenté.
 */
let transporter: Transporter | null = null;

export const isMailerConfigured = (): boolean => !!env.SMTP_HOST;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!isMailerConfigured()) return false;
  try {
    await getTransporter().sendMail({ from: env.SMTP_FROM, to, subject, html });
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, '[Mailer] échec d’envoi');
    return false;
  }
}
