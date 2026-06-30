import { Router } from 'express';
import { authenticate } from '../middleware/auth';

/**
 * Fabrique un routeur « stub » pour un domaine pas encore implémenté.
 * Toutes les routes répondent 501 avec la sous-phase cible.
 */
export const makeStubRouter = (domain: string, phase: string): Router => {
  const router = Router();
  router.use(authenticate);
  router.all(/.*/, (_req, res) => {
    res.status(501).json({ error: `Domaine « ${domain} » non implémenté`, phase });
  });
  return router;
};
