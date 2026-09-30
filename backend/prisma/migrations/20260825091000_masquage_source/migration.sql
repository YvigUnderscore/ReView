-- D'où vient le masquage : d'une règle, ou de la main d'un admin.
--
-- Sans cette colonne, rejouer les règles (au changement de l'une d'elles, ou après un
-- import ShotGrid) devait choisir entre deux torts : effacer les masquages posés à la main,
-- ou ne jamais démasquer ce qu'une règle supprimée couvrait. Elle porte l'identifiant de la
-- règle responsable — volontairement SANS clé étrangère : supprimer une règle laisse ses
-- effets en place jusqu'au recalcul, qui les lèvera proprement en constatant qu'aucune règle
-- ne les revendique plus.
--
-- `updatedAt` perd son DEFAULT : il n'était là que pour peupler la colonne à l'ajout, sur
-- des assets déjà en base. Prisma renseigne toujours la valeur à l'écriture.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "hiddenRuleId" INTEGER,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "hiddenRuleId" INTEGER;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "hiddenRuleId" INTEGER;

-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "hiddenRuleId" INTEGER;

-- Recalcul des règles : « les éléments que cette règle a masqués ». Sans index, chaque
-- passe balayait les quatre tables en entier.
CREATE INDEX "Shot_hiddenRule_idx" ON "Shot"("hiddenRuleId") WHERE "hiddenRuleId" IS NOT NULL;
CREATE INDEX "Sequence_hiddenRule_idx" ON "Sequence"("hiddenRuleId") WHERE "hiddenRuleId" IS NOT NULL;
CREATE INDEX "Asset_hiddenRule_idx" ON "Asset"("hiddenRuleId") WHERE "hiddenRuleId" IS NOT NULL;
CREATE INDEX "Episode_hiddenRule_idx" ON "Episode"("hiddenRuleId") WHERE "hiddenRuleId" IS NOT NULL;
