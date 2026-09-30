-- ─────────────────────────────────────────────────────────────────────────────
-- Contraintes CHECK : les trois XOR du modèle (vague 2 — échelle)
-- ─────────────────────────────────────────────────────────────────────────────
-- Quarante-deux migrations, zéro CHECK. Les trois relations « l'un OU l'autre » du modèle
-- — Task rattachée à un plan XOR un asset, Version à une tâche XOR un asset, Board à un
-- projet XOR un asset — n'étaient déclarées qu'en commentaire, et tenues que par le refine
-- Zod des routes qui les créent. Une écriture par l'API v1, la synchro ShotGrid, un script
-- de reprise ou une migration SQL pouvait produire une ligne rattachée aux deux parents, ou
-- à aucun. Cette ligne-là n'apparaît dans AUCUN listing (tous filtrés par l'un ou l'autre
-- parent) : elle n'est pas fausse, elle est invisible — le pire des deux.
--
-- Prisma ne sait pas exprimer un CHECK ; ces contraintes vivent donc en SQL seul, comme les
-- index partiels d'unicité de `Department` et `PipelineStatus`. Les commentaires de
-- `schema.prisma` les nomment en face de chaque XOR.
--
-- Reprise préalable des lignes en faute, en deux temps : celles rattachées aux DEUX parents
-- sont ramenées au parent le plus spécifique (le plan, la tâche, le projet) ; celles qui
-- n'en ont AUCUN sont supprimées — elles ne sont accessibles par aucun écran ni aucune API,
-- et rien ne permet de deviner où les rattacher.

-- ── Task ─────────────────────────────────────────────────────────────────────────
UPDATE "Task" SET "assetId" = NULL WHERE "shotId" IS NOT NULL AND "assetId" IS NOT NULL;
DELETE FROM "Task" WHERE "shotId" IS NULL AND "assetId" IS NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_parent_xor" CHECK (num_nonnulls("shotId", "assetId") = 1);

-- ── Version ──────────────────────────────────────────────────────────────────────
UPDATE "Version" SET "assetId" = NULL WHERE "taskId" IS NOT NULL AND "assetId" IS NOT NULL;
DELETE FROM "Version" WHERE "taskId" IS NULL AND "assetId" IS NULL;
ALTER TABLE "Version" ADD CONSTRAINT "Version_parent_xor" CHECK (num_nonnulls("taskId", "assetId") = 1);

-- ── Board ────────────────────────────────────────────────────────────────────────
UPDATE "Board" SET "assetId" = NULL WHERE "projectId" IS NOT NULL AND "assetId" IS NOT NULL;
DELETE FROM "Board" WHERE "projectId" IS NULL AND "assetId" IS NULL;
ALTER TABLE "Board" ADD CONSTRAINT "Board_parent_xor" CHECK (num_nonnulls("projectId", "assetId") = 1);

-- ── Compteur de consultations d'un lien de partage ───────────────────────────────
-- `viewCount` n'est qu'incrémenté, et `maxViews` s'y compare pour fermer le lien : un
-- compteur négatif rendrait la limite inopérante sans que rien ne le dise.
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_viewCount_non_negative" CHECK ("viewCount" >= 0);
