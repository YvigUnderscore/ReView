-- ─────────────────────────────────────────────────────────────────────────────
-- Index des tables du pipeline (B3)
-- ─────────────────────────────────────────────────────────────────────────────
-- Aucune des tables les plus sollicitées de l'instance — Task, Version, MediaObject,
-- Comment — ne portait d'index sur ses clés étrangères : Postgres n'en crée pas seul.
-- Or presque toutes les lectures du produit passent par un filtre relationnel imbriqué
-- (`version: { task: { shot: { projectId } } }`), que Postgres traduit en sous-requêtes
-- corrélées. Sans ces index, chacune balayait la table entière.
--
-- Les index composés suivent l'ordre réel des requêtes : d'abord ce qui filtre (le parent,
-- l'état de visibilité), ensuite ce qui trie (la date).

-- Structure du projet : listes de séquences, de plans et d'assets, corbeille exclue.
CREATE INDEX "Sequence_projectId_deletedAt_idx" ON "Sequence"("projectId", "deletedAt");
CREATE INDEX "Shot_projectId_deletedAt_idx" ON "Shot"("projectId", "deletedAt");
CREATE INDEX "Shot_sequenceId_idx" ON "Shot"("sequenceId");
CREATE INDEX "Asset_projectId_deletedAt_idx" ON "Asset"("projectId", "deletedAt");

-- Tâches : par parent (arbre d'un plan ou d'un asset) et par personne (« mes tâches »).
CREATE INDEX "Task_shotId_idx" ON "Task"("shotId");
CREATE INDEX "Task_assetId_idx" ON "Task"("assetId");
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- Versions : par parent, et l'élection de « la dernière version publiée ».
CREATE INDEX "Version_taskId_idx" ON "Version"("taskId");
CREATE INDEX "Version_assetId_idx" ON "Version"("assetId");
CREATE INDEX "Version_deletedAt_published_createdAt_idx" ON "Version"("deletedAt", "published", "createdAt");

-- Médias : la table n'avait aucun index, alors qu'elle est au bout de tous les filtres.
CREATE INDEX "MediaObject_versionId_idx" ON "MediaObject"("versionId");
CREATE INDEX "MediaObject_deletedAt_published_status_createdAt_idx" ON "MediaObject"("deletedAt", "published", "status", "createdAt");

-- Fil de commentaires d'un média : racines puis réponses, dans l'ordre.
CREATE INDEX "Comment_mediaObjectId_parentId_createdAt_idx" ON "Comment"("mediaObjectId", "parentId", "createdAt");
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- Cloche de notifications : les récentes, et le compte de non lues. L'index sur le seul
-- `userId` devient redondant — un index composé sert aussi les requêtes sur son préfixe.
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
DROP INDEX "Notification_userId_idx";

-- Journal d'audit : toujours lu en ordre antéchronologique.
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
