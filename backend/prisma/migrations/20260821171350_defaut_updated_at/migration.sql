-- Solde la dérive laissée par 20260821000000_entity_updated_at.
--
-- Cette migration-là ajoutait `updatedAt` à `Shot` et `Sequence` avec
-- `DEFAULT CURRENT_TIMESTAMP` — indispensable sur le moment pour remplir les lignes
-- existantes d'une colonne NOT NULL — mais ne retirait jamais le défaut ensuite. Or le
-- schéma déclare `updatedAt DateTime @updatedAt`, sans `@default` : migrations et schéma
-- ont donc divergé, et TOUTE `prisma migrate dev` ultérieure embarquait ces deux lignes
-- en passager clandestin, quel que soit son sujet.
--
-- Le retrait est sans effet sur l'application : les colonnes restent NOT NULL et Prisma
-- Client alimente `@updatedAt` à chaque création. Aucune insertion SQL brute ne vise ces
-- deux tables (vérifié sur les migrations, `prisma/seed.ts` et les scripts).

-- AlterTable
ALTER TABLE "Sequence" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Shot" ALTER COLUMN "updatedAt" DROP DEFAULT;
