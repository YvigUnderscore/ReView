-- ─────────────────────────────────────────────────────────────────────────────
-- Retrait de la fonctionnalité « Documents » (C1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Des documents libres (texte riche ou PDF) rattachés au studio, à un projet ou à une
-- entité. La fonctionnalité faisait double emploi avec la documentation produit servie
-- sur /docs — au point que les deux entrées de navigation portaient presque le même nom,
-- et qu'une page de documentation existait pour expliquer laquelle était laquelle.
--
-- Retrait décidé avec le studio. Aucune donnée en production ; les objets MinIO du
-- préfixe `documents/` deviennent orphelins et seront balayés par le nettoyage de stockage.
DROP TABLE IF EXISTS "Document";
DROP TYPE IF EXISTS "DocScope";
DROP TYPE IF EXISTS "DocKind";
