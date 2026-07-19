import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signAccessToken, signRefreshToken, signTwoFaToken, verifyToken } from '../lib/jwt';
import { createSession, isSessionActive, touchSession } from '../lib/sessions';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { toPublicUser, type RawUserIdentity } from '../lib/userView';
import { badRequest, unauthorized } from '../lib/errors';

const router = Router();

const passwordSchema = z
  .string()
  .min(8, 'Mot de passe : 8 caractères minimum')
  .max(128)
  .regex(/[A-Za-z]/, 'Au moins une lettre')
  .regex(/[0-9]/, 'Au moins un chiffre');

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(128),
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });

type UserRow = RawUserIdentity & {
  role: import('@prisma/client').Role;
  status?: import('@prisma/client').UserStatus;
};
const publicUser = (u: UserRow) =>
  toPublicUser({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    firstName: u.firstName ?? null,
    lastName: u.lastName ?? null,
    username: u.username ?? null,
    avatarKey: u.avatarKey ?? null,
  }).then((view) => ({ ...view, role: u.role, status: u.status }));

// POST /api/auth/register — crée un artiste (ouvert ; restreint par invitation en 8.x)
router.post(
  '/register',
  authLimiter,
  validate({
    body: z.object({
      email: z.string().email().max(254),
      password: passwordSchema,
      name: z.string().max(120).optional(),
    }),
  }),
  async (req, res) => {
    const { email, password, name } = req.body as { email: string; password: string; name?: string };
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw badRequest('Email déjà utilisé', 'EMAIL_TAKEN');

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hash, name: name ?? null, role: 'ARTIST' },
    });
    res.status(201).json({ user: await publicUser(user) });
  },
);

// POST /api/auth/login — crée une session révocable (36.B) ; si 2FA actif, renvoie un
// jeton intermédiaire à échanger contre les tokens via /api/auth/2fa/verify (36.A).
router.post('/login', authLimiter, validate({ body: credentialsSchema }), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw unauthorized('Identifiants invalides', 'BAD_CREDENTIALS');
  }
  if (user.totpEnabledAt) {
    res.json({ requires2fa: true, tmpToken: signTwoFaToken(user.id) });
    return;
  }
  const sid = await createSession(user.id, req);
  const payload = { id: user.id, email: user.email, role: user.role, sid };
  res.json({
    token: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    user: await publicUser(user),
  });
});

// POST /api/auth/refresh — exige une session active ; les refresh legacy (sans sid)
// se voient attribuer une session au passage (migration transparente).
router.post('/refresh', validate({ body: z.object({ refreshToken: z.string() }) }), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const payload = verifyToken(refreshToken);
  if (!payload || payload.kind !== 'refresh') throw unauthorized('Refresh token invalide');
  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user) throw unauthorized('Utilisateur introuvable');
  let sid = payload.sid;
  if (sid) {
    if (!(await isSessionActive(sid))) throw unauthorized('Session révoquée', 'SESSION_REVOKED');
    await touchSession(sid);
  } else {
    sid = await createSession(user.id, req);
  }
  const next = { id: user.id, email: user.email, role: user.role, sid };
  res.json({ token: signAccessToken(next), refreshToken: signRefreshToken(next) });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw unauthorized('Utilisateur introuvable');
  res.json({ user: await publicUser(user) });
});

export default router;
