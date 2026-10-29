// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
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

/** Indicates whether the instance is not yet configured (no Studio). */
router.get('/status', async (_req, res) => {
  const studioCount = await prisma.studio.count();
  res.json({ needsSetup: studioCount === 0 });
});

/**
 * Creates the Studio and its ADMIN, or refuses if the instance is already installed.
 *
 * ⚠ The count MUST stay inside the transaction, and the transaction at `Serializable`. Counted outside,
 * two concurrent requests both read "zero studios" and each create a studio and an ADMIN: `Studio.slug
 * @unique` only catches identical names, and this route is public by nature. At `Serializable`, PostgreSQL
 * detects the conflict between the read of the predicate and the insertion: the second transaction fails
 * (P2034), and the installation stays unique.
 */
async function createStudio(name: string, email: string, passwordHash: string, adminName?: string) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        if ((await tx.studio.count()) > 0) {
          throw conflict('The studio is already set up', 'ALREADY_SETUP');
        }
        const studio = await tx.studio.create({ data: { name, slug: slugify(name) } });
        const admin = await tx.user.create({
          data: { email, password: passwordHash, name: adminName ?? null, role: 'ADMIN' },
        });
        return { studio, admin };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    // Serialization conflict or deadlock: the other request won the race, so the instance is installed.
    // It is an installation refusal, not an outage.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2034' || err.code === 'P2002')
    ) {
      throw conflict('The studio is already set up', 'ALREADY_SETUP');
    }
    throw err;
  }
}

/**
 * First launch: creates the Studio (singleton) and the ADMIN account.
 * Refused if a Studio already exists.
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

    // Immediate refusal of the current case (the instance is already installed): the check that counts
    // is the one inside the transaction, further down.
    if ((await prisma.studio.count()) > 0) throw conflict('The studio is already set up', 'ALREADY_SETUP');

    const hash = await bcrypt.hash(adminPassword, 12);
    const { studio, admin } = await createStudio(studioName, normalizeEmail(adminEmail), hash, adminName);

    // Revocable session (36.B): without `sid`, this very first token, the ADMIN's, would be the only one
    // in the system that no revocation could invalidate.
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
