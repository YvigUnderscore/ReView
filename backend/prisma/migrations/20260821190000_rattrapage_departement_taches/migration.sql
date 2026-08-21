-- Rattrapage du rattachement des tâches à leur département (B1).
--
-- La migration 20260817195733 a relié les tâches d'alors ; les chemins d'écriture, eux,
-- ont continué de n'écrire que la chaîne `Task.department` — publication depuis un DCC
-- (PipelineEnsureService) et import ShotGrid (ShotgridPullService, ShotgridSteps). Sur un
-- projet piloté depuis le site, TOUTES les tâches créées depuis portent donc
-- `departmentId = NULL`, et l'assignation par département, qui interroge la relation, les
-- ignore : elle répond « créez la tâche dans ShotGrid d'abord » alors qu'elle existe.
--
-- Le code écrit désormais les deux ; cette migration reprend l'existant. Elle rejoue la
-- même jointure sur `lower(key)`, en y ajoutant la forme normalisée (« Look Development »
-- ↔ `LOOK_DEVELOPMENT`) : les noms d'étapes venus de ShotGrid sont posés tels que le site
-- les écrit, avec espaces et capitales.

-- ─────────────────────────────────────────────────────────────────────────────
-- Clés orphelines : portées par une tâche, connues d'aucune des deux portées
-- ─────────────────────────────────────────────────────────────────────────────
-- `key` reprend la normalisation du service (`DepartmentService.normaliseKey`) pour que la
-- base ne mélange pas deux écritures de la même étape ; `label` garde le texte du site,
-- qui fait un bien meilleur nom affiché.
CREATE TEMP TABLE "_dept_orphelines" AS
SELECT DISTINCT
  p."id"       AS "projectId",
  p."studioId" AS "studioId",
  btrim(t."department") AS "label",
  left(btrim(upper(regexp_replace(btrim(t."department"), '[^A-Za-z0-9]+', '_', 'g')), '_'), 40) AS "key"
FROM "Task" t
LEFT JOIN "Shot" sh ON sh."id" = t."shotId"
LEFT JOIN "Asset" a ON a."id" = t."assetId"
JOIN "Project" p ON p."id" = COALESCE(sh."projectId", a."projectId")
WHERE t."departmentId" IS NULL
  AND t."department" IS NOT NULL
  AND btrim(t."department") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "Department" d
    WHERE d."deletedAt" IS NULL
      AND (d."projectId" = p."id" OR (d."projectId" IS NULL AND d."studioId" = p."studioId"))
      AND (
        lower(d."key") = lower(btrim(t."department"))
        OR left(btrim(upper(regexp_replace(d."key", '[^A-Za-z0-9]+', '_', 'g')), '_'), 40)
           = left(btrim(upper(regexp_replace(btrim(t."department"), '[^A-Za-z0-9]+', '_', 'g')), '_'), 40)
      )
  );

DELETE FROM "_dept_orphelines" WHERE "key" = '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Figer l'héritage des projets concernés AVANT de leur ajouter une étape
-- ─────────────────────────────────────────────────────────────────────────────
-- Un projet sans liste propre hérite de celle du studio, et cette liste est *remplacée*,
-- jamais fusionnée : lui poser une seule étape réduirait son pipe à cette ligne-là. On
-- recopie donc l'héritage à la portée projet avant d'y ajouter quoi que ce soit. La liste
-- des projets est calculée d'abord : après la copie, ils ont tous une liste propre.
CREATE TEMP TABLE "_dept_a_figer" AS
SELECT DISTINCT o."projectId", o."studioId"
FROM "_dept_orphelines" o
WHERE NOT EXISTS (
  SELECT 1 FROM "Department" od WHERE od."projectId" = o."projectId" AND od."deletedAt" IS NULL
);

-- Étape héritée que ce projet portait en corbeille : la clé est prise (l'index d'unicité
-- ignore le soft-delete), la copie ci-dessous la sauterait. On la relève d'abord.
UPDATE "Department" pd
SET "deletedAt" = NULL, "updatedAt" = NOW()
FROM "_dept_a_figer" f
WHERE pd."projectId" = f."projectId"
  AND pd."deletedAt" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Department" sd
    WHERE sd."studioId" = f."studioId" AND sd."projectId" IS NULL AND sd."deletedAt" IS NULL
      AND lower(sd."key") = lower(pd."key")
  );

INSERT INTO "Department" ("studioId", "projectId", "key", "name", "order", "color", "createdAt", "updatedAt")
SELECT sd."studioId", f."projectId", sd."key", sd."name", sd."order", sd."color", NOW(), NOW()
FROM "_dept_a_figer" f
JOIN "Department" sd
  ON sd."studioId" = f."studioId" AND sd."projectId" IS NULL AND sd."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Créer les étapes orphelines à la portée du projet
-- ─────────────────────────────────────────────────────────────────────────────
-- Étape déjà présente mais retirée : on la relève, comme le fait le service — supprimer
-- puis recréer une étape est un geste courant, et du travail s'y rattache encore.
UPDATE "Department" d
SET "deletedAt" = NULL, "updatedAt" = NOW()
FROM "_dept_orphelines" o
WHERE d."projectId" = o."projectId" AND d."deletedAt" IS NOT NULL AND lower(d."key") = lower(o."key");

INSERT INTO "Department" ("studioId", "projectId", "key", "name", "order", "createdAt", "updatedAt")
SELECT DISTINCT ON (o."projectId", o."key") o."studioId", o."projectId", o."key", o."label", 900, NOW(), NOW()
FROM "_dept_orphelines" o
ORDER BY o."projectId", o."key", o."label"
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rattacher les tâches. Le département propre au projet prime sur celui du studio.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Task" t
SET "departmentId" = (
  SELECT d."id"
  FROM "Department" d
  JOIN "Project" p ON p."id" = COALESCE(
    (SELECT sh."projectId" FROM "Shot" sh WHERE sh."id" = t."shotId"),
    (SELECT a."projectId" FROM "Asset" a WHERE a."id" = t."assetId")
  )
  WHERE d."deletedAt" IS NULL
    AND (d."projectId" = p."id" OR (d."projectId" IS NULL AND d."studioId" = p."studioId"))
    AND (
      lower(d."key") = lower(btrim(t."department"))
      OR left(btrim(upper(regexp_replace(d."key", '[^A-Za-z0-9]+', '_', 'g')), '_'), 40)
         = left(btrim(upper(regexp_replace(btrim(t."department"), '[^A-Za-z0-9]+', '_', 'g')), '_'), 40)
    )
  ORDER BY (d."projectId" IS NULL), d."id"
  LIMIT 1
)
WHERE t."departmentId" IS NULL
  AND t."department" IS NOT NULL
  AND btrim(t."department") <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Aligner la clé dénormalisée sur celle du département retenu
-- ─────────────────────────────────────────────────────────────────────────────
-- Le pipe compare sans casse, mais l'affichage et les exports valent mieux qu'un
-- « animation » importé.
UPDATE "Task" t
SET "department" = d."key"
FROM "Department" d
WHERE d."id" = t."departmentId" AND t."department" IS DISTINCT FROM d."key";

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Une version hérite du département de sa tâche
-- ─────────────────────────────────────────────────────────────────────────────
-- Seulement quand elle n'en porte aucun : le champ est corrigeable à la main, et une
-- correction ne se fait pas écraser par un rattrapage.
UPDATE "Version" v
SET "departmentId" = t."departmentId"
FROM "Task" t
WHERE t."id" = v."taskId" AND t."departmentId" IS NOT NULL AND v."departmentId" IS NULL;

DROP TABLE "_dept_a_figer";
DROP TABLE "_dept_orphelines";
