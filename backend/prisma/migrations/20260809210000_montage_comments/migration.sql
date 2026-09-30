-- Retours posés sur un montage (Phase 46).
--
-- Le commentaire garde son ancrage média (`mediaObjectId` + `timestamp`) : c'est ce qui
-- permet de le renvoyer plus tard sur la review du plan, exactement à la bonne frame.
-- `timelineTime` est sa position dans le film entier, seule échelle que la timeline du
-- montage affiche.
ALTER TABLE "Comment" ADD COLUMN "timelineId" INTEGER;
ALTER TABLE "Comment" ADD COLUMN "timelineTime" DOUBLE PRECISION;
ALTER TABLE "Comment" ADD COLUMN "sharedToShot" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Comment_timelineId_idx" ON "Comment"("timelineId");

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_timelineId_fkey"
  FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
