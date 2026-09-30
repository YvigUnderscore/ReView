-- ─────────────────────────────────────────────────────────────────────────────
-- Colonnes et tables mortes (vague 2 — échelle)
-- ─────────────────────────────────────────────────────────────────────────────
-- Ne partent d'ici que les objets dont l'absence totale de lecteur ET d'écrivain a été
-- vérifiée par recherche dans `backend/src` ET `frontend/src`. Deux candidats signalés par
-- l'audit ont été laissés en place après vérification :
--   • `Version.transform` est VIVANT — lu par `useModel3DThree.ts`, écrit par
--     `useSaveTransform.ts` : le supprimer casserait l'orientation 3D ;
--   • `Comment.screenshotKey` n'a aucun écrivain mais garde un lecteur
--     (`ShotgridNoteSync.ts`, avec repli) : le retirer suppose d'abord de toucher ce
--     service, qui n'appartient pas à ce lot ;
--   • la table `PasswordReset` n'a toujours aucun écrivain ni aucun lecteur métier, mais
--     le balayage de rétention (`lib/retention.ts`) l'énumère désormais : la supprimer
--     casserait ce code. Elle reste, signalée comme morte en tête de modèle.

-- ── Reaction : `guestName` mort, `userId` rendu obligatoire ──────────────────────
-- `guestName` était prévu pour un spectateur anonyme du partage client : jamais écrit,
-- jamais lu. Il tenait `userId` en nullable, ce qui sortait discrètement l'unicité du jeu —
-- les NULL étant distincts en SQL, `@@unique([commentId, userId, emoji])` n'empêchait pas
-- cinquante fois le même emoji sur le même commentaire. Le seul écrivain,
-- `CommentService.addReaction`, exige une session : la colonne peut devenir obligatoire.
-- Les lignes sans auteur (il ne peut y en avoir) partent : rien ne saurait les afficher.
DELETE FROM "Reaction" WHERE "userId" IS NULL;
ALTER TABLE "Reaction" DROP COLUMN "guestName",
ALTER COLUMN "userId" SET NOT NULL;
