-- Désactivation de compte : le chemin par défaut d'un départ.
-- La suppression dure faisait converger vers User douze cascades et vingt SetNull, dont
-- AuditLog.userId : le registre d'audit perdait l'auteur des actions journalisées, et un
-- studio ne peut pas laisser s'effacer qui a publié, supprimé ou partagé quoi.
-- Additive et réversible : les comptes existants restent actifs (colonne nulle).
-- Aucun index : la table des comptes se compte en dizaines, et le seul filtre qui la
-- traverse (« reste-t-il un administrateur ? ») est un agrégat ponctuel.
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);
