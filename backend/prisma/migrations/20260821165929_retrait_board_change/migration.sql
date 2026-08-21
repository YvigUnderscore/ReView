-- Retrait du journal `BoardChange`.
--
-- Une ligne y était écrite à CHAQUE sauvegarde de board — or la sauvegarde est
-- autosauvée toutes les 1,2 s pendant qu'on dessine (débounce de `BoardPage`), et le
-- résumé n'était jamais fourni par le client : la table grossissait sans borne, remplie
-- de la même chaîne par défaut. Rien, nulle part, ne l'a jamais relue. Le board porte
-- déjà son `updatedAt` ; un vrai besoin d'audit passerait par `AuditLog`.
--
-- Perte de données assumée : les lignes accumulées n'ont jamais servi à personne.

-- DropForeignKey
ALTER TABLE "BoardChange" DROP CONSTRAINT "BoardChange_boardId_fkey";

-- DropForeignKey
ALTER TABLE "BoardChange" DROP CONSTRAINT "BoardChange_userId_fkey";

-- DropTable
DROP TABLE "BoardChange";
