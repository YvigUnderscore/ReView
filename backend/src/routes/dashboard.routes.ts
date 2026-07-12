import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as DashboardService from '../services/DashboardService';

const router = Router();
router.use(authenticate);

// GET /api/dashboard — données de la page Accueil (dernières reviews, activité,
// mes tâches, stats), bornées aux projets accessibles (membership ; admin/sup = tous).
router.get('/', async (req, res) => {
  res.json(await DashboardService.getDashboard(req.user!));
});

export default router;
