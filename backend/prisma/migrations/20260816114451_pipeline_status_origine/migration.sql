-- AlterTable
ALTER TABLE "PipelineStatus" ADD COLUMN     "isInactive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'local';

-- Origine des statuts déjà en base.
--
-- Six statuts ont été posés par la migration d'intégration (20260815002920, l. 175-181) :
-- ce sont ceux d'un studio qui n'a pas de ShotGrid. Tout le reste a été importé d'un site
-- par la synchronisation. La distinction sert à ne proposer à chaque projet que le
-- vocabulaire qui le concerne : les six statuts locaux hors projet relié, ceux du site
-- sur un projet relié.
UPDATE "PipelineStatus"
SET "origin" = 'shotgrid'
WHERE NOT (
  "scope" = 'task'
  AND "code" IN ('todo', 'in_progress', 'pending_review', 'retake', 'rejected', 'approved')
);

-- Statuts qui ne sont ni « à faire » ni « fait ».
--
-- Un plan omis ou sans objet n'est pas en retard : le compter comme du travail restant
-- fausse toutes les jauges d'avancement d'une production.
UPDATE "PipelineStatus"
SET "isInactive" = true
WHERE "code" IN ('omt', 'dis', 'ign', 'na', 'dcl');
