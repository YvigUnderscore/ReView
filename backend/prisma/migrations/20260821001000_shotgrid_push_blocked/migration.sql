-- Trace des écritures ShotGrid refusées par la matrice de droits.
-- Sans elle, fermer un domaine en écriture faisait disparaître les envois en silence :
-- le job de file se terminait « ok » et rien, nulle part, ne disait pourquoi le statut
-- n'était jamais arrivé sur le site.
ALTER TABLE "ShotgridConnection" ADD COLUMN "pushBlocked" JSONB NOT NULL DEFAULT '{}';
