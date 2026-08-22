-- ─────────────────────────────────────────────────────────────────────────────
-- Recherche : plein texte sur les notes de review, trigrammes sur les noms cherchés
-- ─────────────────────────────────────────────────────────────────────────────
-- La recherche globale ne couvrait que cinq types d'entités, et aucun texte : « le plan où
-- le superviseur a demandé d'enlever le reflet » n'était trouvable nulle part. Elle couvre
-- désormais les médias, les versions, les playlists, les personnes et le CONTENU des
-- commentaires — ce qui suppose deux familles d'index, faute de quoi chaque frappe de la
-- palette balaierait les deux plus grosses tables du studio (50 000 commentaires et
-- 20 000 versions par projet à la volumétrie cible).
--
-- Aucune de ces déclarations n'est exprimable dans `schema.prisma` (index d'expression,
-- classe d'opérateurs de trigrammes) : elles vivent en SQL seul, comme les CHECK des trois
-- XOR et les index partiels d'unicité de `Department` et `PipelineStatus`. Les commentaires
-- de `schema.prisma` les nomment en face des colonnes concernées.
--
-- `IF NOT EXISTS` partout : ces objets peuvent déjà exister sur une base rejouée à la main.

-- ── Trigrammes : ILIKE '%…%' sur les noms ────────────────────────────────────────
-- Un index B-tree ne sert à rien pour un motif non ancré. `pg_trgm` est livré avec
-- l'image postgres (contrib) et n'ajoute aucune dépendance applicative.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- `SH0120_comp_v012.mov` tapé au milieu : c'est la chaîne la plus fréquente en review.
CREATE INDEX IF NOT EXISTS "MediaObject_originalName_trgm_idx"
  ON "MediaObject" USING GIN ("originalName" gin_trgm_ops);

-- `v012` : le nom d'une version EST son numéro de livraison, on le cherche par fragment.
CREATE INDEX IF NOT EXISTS "Version_name_trgm_idx"
  ON "Version" USING GIN ("name" gin_trgm_ops);

-- ── Plein texte : contenu des commentaires ───────────────────────────────────────
-- Configuration `simple` — donc ni stemming ni mots vides : le studio écrit ses retours en
-- quatorze langues et la colonne n'en porte aucune. Un dictionnaire `french` indexerait
-- faux dès la première note en japonais.
--
-- L'expression est reproduite À L'IDENTIQUE par `lib/searchComments.ts`
-- (`to_tsvector('simple', c."content")`) : Postgres n'utilise un index d'expression que si
-- la requête réécrit exactement la même. Toute retouche ici doit être reportée là-bas.
--
-- Le HTML de l'éditeur riche ne pollue pas l'index : l'analyseur par défaut classe les
-- balises en jetons `tag`, absents de la table de correspondance.
CREATE INDEX IF NOT EXISTS "Comment_content_fts_idx"
  ON "Comment" USING GIN (to_tsvector('simple', "content"));
