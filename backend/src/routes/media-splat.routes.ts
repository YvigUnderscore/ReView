import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as SplatEditService from '../services/SplatEditService';

/**
 * Éditions non-destructives d'un splat (10.G) — sous-routeur monté sous /api/media.
 * Écriture réservée aux gestionnaires du média, splat non publié uniquement (vérifié par
 * le service). Le fichier splat original n'est jamais modifié.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const quat = z.tuple([finite, finite, finite, finite]);
const posScale = finite.positive().max(1000);
const scale3 = z.tuple([posScale, posScale, posScale]);

/**
 * PATCH /api/media/:id/splat-edits — enregistre (ou efface si null) les éditions JSON :
 * transformation TRS (gizmos) + volumes de crop SDF (boîte/sphère, creuser/isoler).
 */
router.patch(
  '/:id/splat-edits',
  validate({
    params: idParam,
    body: z.object({
      edits: z
        .object({
          transform: z.object({ position: vec3, quaternion: quat, scale: scale3 }).nullable(),
          volumes: z
            .array(
              z.object({
                shape: z.enum(['box', 'sphere']),
                mode: z.enum(['delete', 'isolate']),
                position: vec3,
                quaternion: quat,
                scale: scale3,
              }),
            )
            .max(32),
          // Flip d'orientation à l'import (11.E) : true/absent = convention Y-down redressée.
          baseFlip: z.boolean().optional(),
        })
        .nullable(),
    }),
  }),
  async (req, res) => {
    res.json(await SplatEditService.setSplatEdits(req.user!, Number(req.params.id), req.body.edits));
  },
);

/**
 * PUT /api/media/:id/splat-mask — masque de suppression par splat (bitset base64 → MinIO).
 * `count` = nombre de splats masqués (affichage/contrôle côté client).
 */
router.put(
  '/:id/splat-mask',
  validate({
    params: idParam,
    body: z.object({
      data: z.string().min(1).max(5_400_000), // bitset base64 (≈ 4 Mo binaire max)
      count: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatMask(req.user!, Number(req.params.id), req.body.data, req.body.count),
    );
  },
);

/** DELETE /api/media/:id/splat-mask — efface le masque de suppression. */
router.delete('/:id/splat-mask', validate({ params: idParam }), async (req, res) => {
  res.json(await SplatEditService.clearSplatMask(req.user!, Number(req.params.id)));
});

/**
 * PUT /api/media/:id/splat-subset — transformations de sous-ensembles de splats (Phase 28) :
 * ops binaires (matrice delta + indices) en base64 → MinIO. `count` = nombre d'ops.
 */
router.put(
  '/:id/splat-subset',
  validate({
    params: idParam,
    body: z.object({
      data: z.string().min(1).max(5_400_000), // ops base64 (≈ 4 Mo binaire max)
      count: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatSubsetOps(
        req.user!,
        Number(req.params.id),
        req.body.data,
        req.body.count,
      ),
    );
  },
);

/** DELETE /api/media/:id/splat-subset — efface les transformations de sous-ensembles. */
router.delete('/:id/splat-subset', validate({ params: idParam }), async (req, res) => {
  res.json(await SplatEditService.clearSplatSubsetOps(req.user!, Number(req.params.id)));
});

const camPose = z.object({
  position: z.object({ x: finite, y: finite, z: finite }),
  target: z.object({ x: finite, y: finite, z: finite }),
  fov: finite.min(5).max(150).optional(),
  // Aspect (largeur/hauteur) du cadre de review fixe (Phase 17) — rejoué en letterbox pour tous.
  aspect: finite.min(0.2).max(5).optional(),
  // Tilt (roll) de la caméra autour de l'axe de vue, en radians (mode layout).
  roll: finite.min(-Math.PI).max(Math.PI).optional(),
});

/**
 * PATCH /api/media/:id/splat-presentation — présentation persistée (10.G-V5) : caméra de base,
 * DoF, reveal, LOD par défaut, animation caméra keyframe. Gestionnaire ; **autorisée même sur
 * un média publié** (mise en scène de la review — le média n'est pas altéré).
 */
router.patch(
  '/:id/splat-presentation',
  validate({
    params: idParam,
    body: z.object({
      presentation: z
        .object({
          camera: camPose.optional(),
          dof: z
            .object({ focalDistance: finite.positive().max(100000), apertureAngle: finite.min(0).max(1) })
            .optional(),
          reveal: z
            .object({
              type: z.enum(['fade', 'sweep', 'dissolve']),
              durationMs: z.number().int().min(100).max(30000),
            })
            .optional(),
          lodDefault: z.enum(['auto', 'on', 'off', 'streaming']).optional(),
          // Éclairage/HDRI par défaut du viewer 3D (Phase 29) — rejoué pour tous.
          lighting: z
            .object({
              hdriId: z.string().max(300).optional(),
              exposure: finite.min(0).max(10),
              rotationDeg: finite.min(-360).max(360),
              showBackground: z.boolean(),
              // Sol récepteur d'ombres (39.F) — optionnel (tolère les présentations antérieures).
              groundShadow: z.boolean().optional(),
            })
            .optional(),
          // Bookmarks caméra partagés (39.D) : vues nommées rejouées/rappelables pour tous.
          bookmarks: z
            .array(z.object({ label: z.string().max(40).optional(), camera: camPose }))
            .max(12)
            .optional(),
          // Animation caméra « par canaux » (Phase 17, v2) : F-curves éditables (position/cible/
          // focale/tilt), tangentes Hermite. Remplace le format v1 (keyframes + easing).
          cameraAnim: z
            .object({
              version: z.literal(2),
              loop: z.boolean(),
              durationMs: z.number().int().min(0).max(3600000).optional(),
              channels: z.record(
                z.enum(['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll']),
                z.object({
                  keys: z
                    .array(
                      z.object({
                        t: finite.min(0).max(3600000), // ms depuis le début
                        v: finite,
                        tin: finite.optional(),
                        tout: finite.optional(),
                        mode: z.enum(['auto', 'linear', 'step', 'free']),
                      }),
                    )
                    .min(1)
                    .max(256),
                }),
              ),
            })
            .optional(),
        })
        .nullable(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatPresentation(req.user!, Number(req.params.id), req.body.presentation),
    );
  },
);

export default router;
