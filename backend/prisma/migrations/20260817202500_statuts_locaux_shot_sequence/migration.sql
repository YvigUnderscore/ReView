-- ─────────────────────────────────────────────────────────────────────────────
-- Statuts locaux de plan et de séquence (B2, correctif)
-- ─────────────────────────────────────────────────────────────────────────────
-- La migration précédente voulait semer un vocabulaire local pour `shot` et `sequence`,
-- mais l'unicité `(scope, code)` du référentiel studio l'en empêchait : les codes `wtg`,
-- `ip`, `fin` y existaient déjà, importés d'un site ShotGrid.
--
-- Or ces deux vocabulaires doivent coexister au niveau du studio : `listForProject` sert
-- l'un ou l'autre selon que le projet est relié. L'unicité inclut donc l'origine. Sans ce
-- correctif, un projet non relié demandant les statuts de plan ne recevait rien, et le
-- repli lui servait le vocabulaire d'un site auquel il n'est pas relié.

DROP INDEX IF EXISTS "PipelineStatus_studio_code_unique";
CREATE UNIQUE INDEX "PipelineStatus_studio_code_unique"
  ON "PipelineStatus"("scope", "code", "origin")
  WHERE "projectId" IS NULL;

INSERT INTO "PipelineStatus" ("scope", "code", "name", "color", "order", "isDone", "isDefault", "origin", "isInactive", "legacyStatus", "createdAt", "updatedAt")
SELECT s."scope", s."code", s."name", s."color", s."ord", s."done", s."def", 'local', s."inactive", s."legacy"::"TaskStatus", NOW(), NOW()
FROM (VALUES
  ('shot', 'wtg', 'Waiting to Start', '#9BA3B2', 0, false, true,  false, 'TODO'),
  ('shot', 'ip',  'In Progress',      '#3B82F6', 1, false, false, false, 'IN_PROGRESS'),
  ('shot', 'rev', 'Pending Review',   '#F59E0B', 2, false, false, false, 'PENDING_REVIEW'),
  ('shot', 'fin', 'Final',            '#22C55E', 3, true,  false, false, 'APPROVED'),
  ('shot', 'omt', 'Omitted',          '#6B7280', 4, false, false, true,  'TODO'),
  ('sequence', 'wtg', 'Waiting to Start', '#9BA3B2', 0, false, true,  false, 'TODO'),
  ('sequence', 'ip',  'In Progress',      '#3B82F6', 1, false, false, false, 'IN_PROGRESS'),
  ('sequence', 'fin', 'Final',            '#22C55E', 2, true,  false, false, 'APPROVED')
) AS s("scope", "code", "name", "color", "ord", "done", "def", "inactive", "legacy")
WHERE NOT EXISTS (
  SELECT 1 FROM "PipelineStatus" p
  WHERE p."projectId" IS NULL AND p."origin" = 'local'
    AND p."scope" = s."scope" AND p."code" = s."code"
);
