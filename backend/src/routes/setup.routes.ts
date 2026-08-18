// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { signAccessToken } from '../lib/jwt';
import { createSession } from '../lib/sessions';
import { normalizeEmail } from '../lib/email';
import { conflict } from '../lib/errors';

const router = Router();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'studio';

/** Indique si l'instance n'est pas encore configurée (aucun Studio). */
router.get('/status', async (_req, res) => {
  const studioCount = await prisma.studio.count();
  res.json({ needsSetup: studioCount === 0 });
});

/**
 * Premier lancement : crée le Studio (singleton) et le compte ADMIN.
 * Refusé si un Studio existe déjà.
 */
router.post(
  '/',
  validate({
    body: z.object({
      studioName: z.string().min(2).max(120),
      adminEmail: z.string().email().max(254),
      adminPassword: z
        .string()
        .min(8)
        .max(128)
        .regex(/[A-Za-z]/)
        .regex(/[0-9]/),
      adminName: z.string().max(120).optional(),
    }),
  }),
  async (req, res) => {
    const { studioName, adminEmail, adminPassword, adminName } = req.body as {
      studioName: string;
      adminEmail: string;
      adminPassword: string;
      adminName?: string;
    };

    if ((await prisma.studio.count()) > 0) throw conflict('The studio is already set up', 'ALREADY_SETUP');

    const hash = await bcrypt.hash(adminPassword, 12);
    const { studio, admin } = await prisma.$transaction(async (tx) => {
      const studio = await tx.studio.create({ data: { name: studioName, slug: slugify(studioName) } });
      const admin = await tx.user.create({
        data: {
          email: normalizeEmail(adminEmail),
          password: hash,
          name: adminName ?? null,
          role: 'ADMIN',
        },
      });
      return { studio, admin };
    });

    // Session révocable (36.B) : sans `sid`, ce tout premier jeton — celui de l'ADMIN —
    // serait le seul du système qu'aucune révocation ne pourrait invalider.
    const sid = await createSession(admin.id, req);
    const token = signAccessToken({ id: admin.id, email: admin.email, role: admin.role, sid });
    res.status(201).json({
      studio: { id: studio.id, name: studio.name, slug: studio.slug },
      user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
      token,
    });
  },
);

export default router;
