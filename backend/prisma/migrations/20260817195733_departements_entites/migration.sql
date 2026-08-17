-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "departmentId" INTEGER;

-- AlterTable
ALTER TABLE "Version" ADD COLUMN     "departmentId" INTEGER;

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "studioId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserDepartments" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_ShotDepartments" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_SequenceDepartments" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_AssetDepartments" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "Department_studioId_projectId_order_idx" ON "Department"("studioId", "projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "_UserDepartments_AB_unique" ON "_UserDepartments"("A", "B");

-- CreateIndex
CREATE INDEX "_UserDepartments_B_index" ON "_UserDepartments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ShotDepartments_AB_unique" ON "_ShotDepartments"("A", "B");

-- CreateIndex
CREATE INDEX "_ShotDepartments_B_index" ON "_ShotDepartments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_SequenceDepartments_AB_unique" ON "_SequenceDepartments"("A", "B");

-- CreateIndex
CREATE INDEX "_SequenceDepartments_B_index" ON "_SequenceDepartments"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_AssetDepartments_AB_unique" ON "_AssetDepartments"("A", "B");

-- CreateIndex
CREATE INDEX "_AssetDepartments_B_index" ON "_AssetDepartments"("B");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserDepartments" ADD CONSTRAINT "_UserDepartments_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserDepartments" ADD CONSTRAINT "_UserDepartments_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShotDepartments" ADD CONSTRAINT "_ShotDepartments_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShotDepartments" ADD CONSTRAINT "_ShotDepartments_B_fkey" FOREIGN KEY ("B") REFERENCES "Shot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SequenceDepartments" ADD CONSTRAINT "_SequenceDepartments_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SequenceDepartments" ADD CONSTRAINT "_SequenceDepartments_B_fkey" FOREIGN KEY ("B") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetDepartments" ADD CONSTRAINT "_AssetDepartments_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetDepartments" ADD CONSTRAINT "_AssetDepartments_B_fkey" FOREIGN KEY ("B") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Unicité de la clé (index partiels)
-- ─────────────────────────────────────────────────────────────────────────────
-- Un `@@unique([studioId, projectId, key])` ordinaire ne protégerait pas les départements
-- de studio : Postgres tient les NULL pour distincts, donc deux lignes `projectId IS NULL`
-- de même clé passeraient. D'où deux index partiels, un par portée.
CREATE UNIQUE INDEX "Department_studio_key_unique" ON "Department"("studioId", "key")
  WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX "Department_project_key_unique" ON "Department"("projectId", "key")
  WHERE "projectId" IS NOT NULL;

-- Clés étrangères de rattachement : Postgres ne les indexe pas seul, et elles servent de
-- filtre à chaque regroupement par département.
CREATE INDEX "Task_departmentId_idx" ON "Task"("departmentId");
CREATE INDEX "Version_departmentId_idx" ON "Version"("departmentId");

-- ─────────────────────────────────────────────────────────────────────────────
-- Reprise des données existantes
-- ─────────────────────────────────────────────────────────────────────────────
-- Trois passes, de la plus générale à la plus particulière :
--   1. les départements par défaut du studio, lus dans les réglages studio s'ils existent ;
--   2. ceux que chaque projet a redéfinis pour lui-même ;
--   3. les clés que portent réellement les tâches et qu'aucune des deux listes ne connaît —
--      typiquement les étapes importées de ShotGrid (« Art », « Groom »), qui se retrouvaient
--      jusqu'ici dans le fourre-tout « sans département ».
-- Puis on relie les tâches, d'abord au département de leur projet, sinon à celui du studio.

-- 1. Référentiel du studio. `project_defaults` porte les réglages saisis en administration ;
--    en son absence, on reprend le jeu de repli du code (lib/projectSettings.ts).
INSERT INTO "Department" ("studioId", "projectId", "key", "name", "order", "createdAt", "updatedAt")
SELECT s."id", NULL, d."key", d."name", d."ord", NOW(), NOW()
FROM "Studio" s
CROSS JOIN LATERAL (
  SELECT
    elem->>'key' AS "key",
    COALESCE(elem->>'name', elem->>'key') AS "name",
    (ord - 1)::int AS "ord"
  FROM (SELECT value FROM "Setting" WHERE key = 'project_defaults') cfg,
       jsonb_array_elements((cfg.value::jsonb)->'departments') WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof((cfg.value::jsonb)->'departments') = 'array'
  UNION ALL
  SELECT f."key", f."name", f."ord"
  FROM (VALUES
    ('MODELING', 'Modeling', 0), ('RIGGING', 'Rigging', 1), ('ANIMATION', 'Animation', 2),
    ('FX', 'FX', 3), ('LIGHTING', 'Lighting', 4), ('COMPOSITING', 'Compositing', 5),
    ('LOOKDEV', 'Look Dev', 6), ('LAYOUT', 'Layout', 7)
  ) AS f("key", "name", "ord")
  WHERE NOT EXISTS (
    SELECT 1 FROM "Setting"
    WHERE key = 'project_defaults'
      AND jsonb_typeof((value::jsonb)->'departments') = 'array'
      AND jsonb_array_length((value::jsonb)->'departments') > 0
  )
) d
WHERE d."key" IS NOT NULL AND d."key" <> ''
ON CONFLICT DO NOTHING;

-- 2. Surcharges par projet (uniquement celles qui diffèrent du studio).
INSERT INTO "Department" ("studioId", "projectId", "key", "name", "order", "createdAt", "updatedAt")
SELECT p."studioId", p."id", d."key", d."name", d."ord", NOW(), NOW()
FROM "Project" p
CROSS JOIN LATERAL (
  SELECT
    elem->>'key' AS "key",
    COALESCE(elem->>'name', elem->>'key') AS "name",
    (ord - 1)::int AS "ord"
  FROM jsonb_array_elements(p."settings"->'departments') WITH ORDINALITY AS t(elem, ord)
) d
WHERE jsonb_typeof(p."settings"->'departments') = 'array'
  AND d."key" IS NOT NULL AND d."key" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "Department" sd
    WHERE sd."studioId" = p."studioId" AND sd."projectId" IS NULL
      AND lower(sd."key") = lower(d."key")
  )
ON CONFLICT DO NOTHING;

-- 3. Clés orphelines portées par des tâches (étapes ShotGrid importées telles quelles).
INSERT INTO "Department" ("studioId", "projectId", "key", "name", "order", "createdAt", "updatedAt")
SELECT DISTINCT ON (p."id", lower(t."department"))
       p."studioId", p."id", t."department", t."department", 900, NOW(), NOW()
FROM "Task" t
LEFT JOIN "Shot" sh ON sh."id" = t."shotId"
LEFT JOIN "Asset" a ON a."id" = t."assetId"
JOIN "Project" p ON p."id" = COALESCE(sh."projectId", a."projectId")
WHERE t."department" IS NOT NULL AND t."department" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "Department" d
    WHERE lower(d."key") = lower(t."department")
      AND (d."projectId" = p."id" OR (d."projectId" IS NULL AND d."studioId" = p."studioId"))
  )
ORDER BY p."id", lower(t."department"), t."id"
ON CONFLICT DO NOTHING;

-- 4. Rattachement des tâches. Le département propre au projet prime sur celui du studio.
UPDATE "Task" t
SET "departmentId" = (
  SELECT d."id"
  FROM "Department" d
  JOIN "Project" p ON p."id" = COALESCE(
    (SELECT sh."projectId" FROM "Shot" sh WHERE sh."id" = t."shotId"),
    (SELECT a."projectId" FROM "Asset" a WHERE a."id" = t."assetId")
  )
  WHERE lower(d."key") = lower(t."department")
    AND (d."projectId" = p."id" OR (d."projectId" IS NULL AND d."studioId" = p."studioId"))
  ORDER BY (d."projectId" IS NULL), d."id"
  LIMIT 1
)
WHERE t."department" IS NOT NULL AND t."department" <> '';

-- 5. La clé dénormalisée reprend la casse exacte du département retenu : le pipe compare
--    sans casse, mais l'affichage et les exports valent mieux qu'un « animation » importé.
UPDATE "Task" t SET "department" = d."key"
FROM "Department" d
WHERE d."id" = t."departmentId" AND t."department" IS DISTINCT FROM d."key";

-- 6. Une version hérite du département de sa tâche.
UPDATE "Version" v SET "departmentId" = t."departmentId"
FROM "Task" t
WHERE t."id" = v."taskId" AND t."departmentId" IS NOT NULL;
