-- Marqueur de dernière modification sur Sequence et Shot.
-- Sans lui, la synchronisation ShotGrid n'avait aucun repère pour savoir si ReView avait
-- bougé depuis la dernière passe : la détection de conflit de statut y était morte.
-- Les lignes existantes prennent l'heure de la migration : elles sont toutes antérieures
-- à la prochaine synchronisation, donc jamais déclarées en conflit à tort.
ALTER TABLE "Sequence" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Shot" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
