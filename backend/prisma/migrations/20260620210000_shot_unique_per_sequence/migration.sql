-- Le code de shot devient unique PAR SÉQUENCE (et non plus par projet).
-- SH001 peut ainsi coexister dans plusieurs séquences. Les shots sans séquence
-- (sequenceId NULL) restent distincts entre eux (NULL distincts en SQL).
DROP INDEX IF EXISTS "Shot_projectId_code_key";
CREATE UNIQUE INDEX "Shot_projectId_sequenceId_code_key" ON "Shot"("projectId", "sequenceId", "code");
