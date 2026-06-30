-- Réglages projet (départements, nomenclature) : colonne JSON sur Project
ALTER TABLE "Project" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
