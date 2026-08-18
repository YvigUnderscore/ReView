-- États de commentaire (D1) : « en cours », « question », « ne sera pas corrigé » se
-- disaient dans le texte, donc nulle part de lisible.
CREATE TYPE "CommentState" AS ENUM ('OPEN', 'WIP', 'QUESTION', 'WONT_FIX', 'RESOLVED');
ALTER TABLE "Comment" ADD COLUMN "state" "CommentState" NOT NULL DEFAULT 'OPEN';

-- Reprise : ce qui était résolu le reste. `isResolved` continue d'être écrit en parallèle.
UPDATE "Comment" SET "state" = 'RESOLVED' WHERE "isResolved" = true;
