-- ─────────────────────────────────────────────────────────────────────────────
-- MediaObject : porter l'ORDRE des listings, pas un filtre qui ne filtre rien
-- ─────────────────────────────────────────────────────────────────────────────
-- Les deux listings triés du produit — la bibliothèque d'un projet
-- (`MediaService.listPublished`) et la page Reviews (`MediaService.listReviews`) — font
-- `ORDER BY "createdAt" DESC` avec `LIMIT`. L'index `[deletedAt, published, status,
-- createdAt]` avait été posé pour eux. Il ne les a jamais servis, pour deux raisons
-- vérifiées sur base de sonde (40 000 médias, 60 000 versions, 20 000 plans, 50 000 assets) :
--
--  1. ses trois colonnes de tête portent la même valeur pour la quasi-totalité des lignes
--     (`deletedAt` NULL, `published` vrai, `status` READY) : elles ne discriminent rien ;
--  2. surtout, Prisma n'écrit PAS `status = 'READY'` mais
--     `status = CAST($n::text AS "MediaStatus")`. La fonction d'entrée d'un enum
--     (`enum_in`) est STABLE et non IMMUTABLE : Postgres ne sait pas prouver l'égalité à
--     une constante, ne peut donc pas s'en servir pour ordonner, et ne peut pas non plus
--     l'utiliser pour prouver le prédicat d'un index partiel. Un index — partiel ou non —
--     qui mentionne `status` est donc inerte vis-à-vis de l'application.
--
-- Constaté sur la base de développement : `idx_scan = 0` sur cet index.
-- Plan mesuré AVANT, requête SQL exacte émise par Prisma :
--   Seq Scan on "MediaObject" + hash joins + top-N heapsort, `shared hit=4466` (bibliothèque)
--   et `shared hit=4467` (Reviews), 76 ms et 83 ms.
-- Plan mesuré APRÈS : `Index Scan using "MediaObject_alive_recent_idx"`, boucles imbriquées,
--   aucun tri, `shared hit=1337` (1,0 ms) et `shared hit=257` (0,8 ms). Le parcours s'arrête
--   à la page demandée : son coût cesse de croître avec le nombre total de médias du studio.
--
-- Aucune de ces déclarations n'est exprimable dans `schema.prisma` (prédicat partiel, sens
-- de tri) : elles vivent en SQL seul, comme les trigrammes de
-- `20260822120000_recherche_plein_texte_commentaires` et les unicités partielles de
-- `Department`/`PipelineStatus`. Les commentaires de `schema.prisma` les nomment en face
-- de la table.

DROP INDEX IF EXISTS "MediaObject_deletedAt_published_status_createdAt_idx";

-- L'ordre des listings. Le prédicat ne retient QUE `IS NULL` : c'est la seule clause que
-- Prisma écrit littéralement (les booléens et les enums passent par des paramètres), donc
-- la seule que le prouveur de prédicats sait impliquer. `id DESC` en queue ne sert pas le
-- tri demandé — il départage les médias déposés dans la même milliseconde, pour qu'une page
-- 2 ne puisse pas réafficher une ligne déjà vue.
CREATE INDEX IF NOT EXISTS "MediaObject_alive_recent_idx"
  ON "MediaObject" ("createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

-- L'autre moitié de la table, et son unique lecteur : le balayage de purge de corbeille
-- (`lib/trash.ts`, `deletedAt < cutoff`). Sans lui, retirer l'index à quatre colonnes
-- renverrait cette purge sur un parcours complet de `MediaObject_uploaderId_deletedAt_idx`
-- (mesuré : 37 blocs contre 3). L'index partiel ne contient que les médias en corbeille :
-- quelques milliers de lignes là où la table en compte des centaines de milliers.
CREATE INDEX IF NOT EXISTS "MediaObject_trashed_idx"
  ON "MediaObject" ("deletedAt")
  WHERE "deletedAt" IS NOT NULL;
