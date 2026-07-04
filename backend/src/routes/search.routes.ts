import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { searchEntities } from '../lib/search';

const router = Router();
router.use(authenticate);

// GET /api/search?q=… — recherche globale (projets, séquences, shots, assets, tâches)
router.get('/', validate({ query: z.object({ q: z.string().trim().min(1).max(100) }) }), async (req, res) => {
  const q = String(req.query.q);
  const { id, role } = req.user!;
  res.json(await searchEntities(q, id, role));
});

export default router;
