-- ─────────────────────────────────────────────────────────────────────────────
-- Index de clés étrangères (vague 2 — échelle)
-- ─────────────────────────────────────────────────────────────────────────────
-- Postgres indexe la colonne RÉFÉRENCÉE d'une clé étrangère, jamais la colonne qui
-- référence. Trente-quatre colonnes de rattachement sur vingt-sept modèles n'avaient donc
-- aucun index de tête. Deux conséquences, l'une chaude, l'autre froide :
--
--   • chaud : chaque demande d'upload somme les tailles des médias de l'uploader
--     (`MediaService`, aggregate _sum sur `uploaderId`) — sans index, un balayage complet
--     de MediaObject à chaque fichier déposé ;
--   • froid mais bloquant : supprimer un compte déclenche une vingtaine d'UPDATE SetNull
--     et une douzaine de DELETE en cascade dans UNE transaction. À la volumétrie cible
--     (50 000 commentaires et 20 000 versions par projet), dix-neuf de ces passes étaient
--     des balayages complets, verrous compris.
--
-- Quelques index existants sont remplacés plutôt que doublés : quand la requête filtre sur
-- la clé étrangère PUIS trie, la colonne de tri est ajoutée en queue. Le préfixe reste
-- identique, l'ancien usage (jointure, cascade) est donc intégralement conservé.

-- ── Référentiels & identité ──────────────────────────────────────────────────────
CREATE INDEX "Department_projectId_idx" ON "Department"("projectId");
CREATE INDEX "ApiToken_createdById_idx" ON "ApiToken"("createdById");
CREATE INDEX "Invitation_invitedById_idx" ON "Invitation"("invitedById");
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");
-- « Qui est membre de ce projet » : lu à chaque contrôle d'accès, jamais indexé — l'unicité
-- existante commence par `userId` et répond à l'autre question.
CREATE INDEX "ProjectMembership_projectId_idx" ON "ProjectMembership"("projectId");

-- ── Journal d'événements de l'API v1 ─────────────────────────────────────────────
-- Le polling lit « les événements de mes projets postérieurs à ce curseur, dans l'ordre des
-- id » : c'est le projet qui filtre et l'id qui trie. L'ancien index avait l'id en tête et
-- ne faisait donc rien que la clé primaire ne fasse déjà.
DROP INDEX "ApiEvent_id_projectId_idx";
CREATE INDEX "ApiEvent_projectId_id_idx" ON "ApiEvent"("projectId", "id");
CREATE INDEX "ApiEvent_actorId_idx" ON "ApiEvent"("actorId");

-- ── Hiérarchie pipeline ──────────────────────────────────────────────────────────
-- Listes paginées d'un long-métrage (2000 plans) : filtre projet + corbeille, tri par
-- `order`. La clé de départage finale évite qu'un ex æquo change de page entre deux appels.
DROP INDEX "Sequence_projectId_deletedAt_idx";
CREATE INDEX "Sequence_projectId_deletedAt_order_code_idx" ON "Sequence"("projectId", "deletedAt", "order", "code");
CREATE INDEX "Sequence_pipelineStatusId_idx" ON "Sequence"("pipelineStatusId");

DROP INDEX "Shot_projectId_deletedAt_idx";
DROP INDEX "Shot_sequenceId_idx";
CREATE INDEX "Shot_projectId_deletedAt_order_id_idx" ON "Shot"("projectId", "deletedAt", "order", "id");
CREATE INDEX "Shot_sequenceId_deletedAt_order_idx" ON "Shot"("sequenceId", "deletedAt", "order");
CREATE INDEX "Shot_pipelineStatusId_idx" ON "Shot"("pipelineStatusId");

-- Le kanban d'un plan ou d'un asset lit ses tâches triées par `order`.
DROP INDEX "Task_shotId_idx";
DROP INDEX "Task_assetId_idx";
CREATE INDEX "Task_shotId_order_idx" ON "Task"("shotId", "order");
CREATE INDEX "Task_assetId_order_idx" ON "Task"("assetId", "order");
-- `PipelineStatusService` compte tâches et plans par statut avant chaque suppression de
-- statut, et le SetNull de cette suppression repasse sur les mêmes colonnes.
CREATE INDEX "Task_pipelineStatusId_idx" ON "Task"("pipelineStatusId");
CREATE INDEX "Task_sourceCommentId_idx" ON "Task"("sourceCommentId");

-- Historique d'une tâche/d'un asset : versions vivantes, de la plus récente à la plus ancienne.
DROP INDEX "Version_taskId_idx";
DROP INDEX "Version_assetId_idx";
CREATE INDEX "Version_taskId_deletedAt_createdAt_idx" ON "Version"("taskId", "deletedAt", "createdAt");
CREATE INDEX "Version_assetId_deletedAt_createdAt_idx" ON "Version"("assetId", "deletedAt", "createdAt");
CREATE INDEX "Version_authorId_idx" ON "Version"("authorId");
CREATE INDEX "Version_reviewStatusId_idx" ON "Version"("reviewStatusId");

-- ── Médias, review, dailies ──────────────────────────────────────────────────────
-- Quota par personne (somme des tailles à chaque upload) + SetNull à la suppression d'un
-- compte. `deletedAt` en queue permet en prime d'écarter la corbeille dans l'index.
CREATE INDEX "MediaObject_uploaderId_deletedAt_idx" ON "MediaObject"("uploaderId", "deletedAt");
CREATE INDEX "MediaAccessLog_userId_createdAt_idx" ON "MediaAccessLog"("userId", "createdAt");
CREATE INDEX "TimelineMarker_authorId_idx" ON "TimelineMarker"("authorId");
CREATE INDEX "ReviewReference_createdById_idx" ON "ReviewReference"("createdById");
-- `onDelete: Restrict` sur le statut : la suppression compte d'abord les décisions.
CREATE INDEX "ReviewDecision_statusId_idx" ON "ReviewDecision"("statusId");
CREATE INDEX "ReviewDecision_authorId_idx" ON "ReviewDecision"("authorId");
CREATE INDEX "Playlist_createdById_idx" ON "Playlist"("createdById");
CREATE INDEX "PlaylistItem_versionId_idx" ON "PlaylistItem"("versionId");
CREATE INDEX "Timeline_sequenceId_idx" ON "Timeline"("sequenceId");
CREATE INDEX "TimelineSnapshot_createdById_idx" ON "TimelineSnapshot"("createdById");

-- Trois clés étrangères vers User sur la table la plus grosse du modèle (50 000 lignes par
-- projet à la cible) : sans index, offboarder quelqu'un la balayait trois fois.
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");
CREATE INDEX "Comment_resolvedById_idx" ON "Comment"("resolvedById");
CREATE INDEX "Comment_assigneeId_idx" ON "Comment"("assigneeId");
CREATE INDEX "Reaction_userId_idx" ON "Reaction"("userId");

-- ── Diffusion, notifications, audit, messagerie ─────────────────────────────────
CREATE INDEX "ShareLink_projectId_createdAt_idx" ON "ShareLink"("projectId", "createdAt");
CREATE INDEX "ShareLink_createdById_idx" ON "ShareLink"("createdById");
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "Conversation_createdById_idx" ON "Conversation"("createdById");
CREATE INDEX "ChatMessage_authorId_idx" ON "ChatMessage"("authorId");
CREATE INDEX "ShotgridSyncRun_triggeredById_idx" ON "ShotgridSyncRun"("triggeredById");
