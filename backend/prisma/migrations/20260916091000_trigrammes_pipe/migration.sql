-- ─────────────────────────────────────────────────────────────────────────────
-- Palette Ctrl+K : trigrammes sur les tables du pipe réellement cherchées
-- ─────────────────────────────────────────────────────────────────────────────
-- `20260822120000_recherche_plein_texte_commentaires` a posé le bon raisonnement — « un
-- index B-tree ne sert à rien pour un motif non ancré » — mais ne l'a appliqué qu'à
-- `MediaObject.originalName` et `Version.name`. `lib/search.ts` applique pourtant la même
-- forme `ILIKE '%…%'` au pipe entier, à chaque frappe.
--
-- Deux règles ont guidé le choix des colonnes, toutes deux mesurées sur base de sonde
-- (20 000 plans, 50 000 assets, 60 000 tâches, 5 200 séquences), avec le terme qui ne
-- correspond à rien — le cas le plus fréquent en cours de frappe :
--
--  1. **Une colonne d'un `OR` ne s'indexe pas seule.** `name ILIKE … OR code ILIKE … OR
--     description ILIKE …` n'emprunte un `BitmapOr` que si les TROIS branches sont
--     indexables ; il suffit d'en oublier une pour retomber sur le balayage complet. Les
--     `description` sont donc indexées elles aussi, plutôt que sorties du `OR` — les en
--     sortir changerait les résultats, ce qui n'est pas une optimisation mais un défaut.
--  2. **Seules les tables dont le volume suit la production.** Mesuré : Shot passe de 310
--     à 30 blocs lus (12,4 ms → 0,27 ms), Asset de 892 à 20 (20,8 ms → 0,13 ms), Task de
--     775 à 21 (25,6 ms → 1,2 ms). En revanche `Sequence`, même portée à 5 200 lignes
--     (80 blocs), garde un `Seq Scan` : le planificateur juge le GIN plus cher, et l'index
--     ne serait qu'un coût d'écriture. Même verdict pour `Project`, `Playlist`, `User` et
--     `Department`, bornés par la taille du studio et mesurés à 2 ou 3 blocs. Le jour où
--     l'une d'elles franchit quelques centaines de blocs, c'est ici qu'on l'ajoute.
--
-- `Task` demande une troisième condition, côté applicatif : la palette cherche aussi le
-- LIBELLÉ du département, qui vit dans `Department.name`. Tant que cette branche du `OR`
-- traversait la jointure, aucun index de `Task` ne pouvait s'appliquer (un `BitmapOr` ne
-- franchit pas une table) — c'est pourquoi `lib/search.ts` résout désormais les
-- départements en identifiants AVANT d'interroger les tâches. Les deux changements ne
-- valent que l'un par l'autre.
--
-- `CREATE EXTENSION pg_trgm` est déjà posé par la migration de 2026-08-22.
-- `IF NOT EXISTS` partout : ces objets peuvent déjà exister sur une base rejouée à la main.
--
-- Ces sept index SONT déclarés dans `schema.prisma` (`ops: raw("gin_trgm_ops")`, `type: Gin`),
-- contrairement aux deux trigrammes de 2026-08 dont la migration a cru la chose inexprimable :
-- le contrôle de dérive garde ainsi le modèle et la base d'accord sans liste d'exceptions.
--
-- Exploitation : un `CREATE INDEX` prend un verrou qui bloque les écritures de la table le
-- temps de la construction — instantané sur une base de studio naissante, quelques secondes
-- sur des centaines de milliers de lignes. `CONCURRENTLY` n'est pas utilisable ici, Prisma
-- jouant chaque migration dans une transaction ; sur une instance chargée, jouer ce fichier
-- pendant une fenêtre calme.

-- ── Plans ────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Shot_name_trgm_idx" ON "Shot" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Shot_code_trgm_idx" ON "Shot" USING GIN ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Shot_description_trgm_idx" ON "Shot" USING GIN ("description" gin_trgm_ops);

-- ── Assets ───────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Asset_name_trgm_idx" ON "Asset" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Asset_description_trgm_idx" ON "Asset" USING GIN ("description" gin_trgm_ops);

-- ── Tâches ───────────────────────────────────────────────────────────────────────
-- `department` est la clé dénormalisée de l'étape (`lookdev`), que l'artiste tape aussi.
CREATE INDEX IF NOT EXISTS "Task_name_trgm_idx" ON "Task" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_department_trgm_idx" ON "Task" USING GIN ("department" gin_trgm_ops);
