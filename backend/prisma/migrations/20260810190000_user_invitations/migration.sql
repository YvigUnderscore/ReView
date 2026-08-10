-- Invitation d'un nouveau membre par email (Phase 47).
--
-- Le compte est créé tout de suite (rôle, quota, projets peuvent être préparés), mais son
-- mot de passe est un secret aléatoire que personne ne connaît : seul le lien reçu par
-- email permet d'en choisir un. Le jeton n'est stocké que haché (SHA-256), comme un mot
-- de passe — une base exfiltrée ne doit livrer aucun lien d'activation utilisable.
CREATE TABLE "Invitation" (
  "id"          SERIAL       NOT NULL,
  "userId"      INTEGER      NOT NULL,
  "tokenHash"   TEXT         NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "acceptedAt"  TIMESTAMP(3),
  "invitedById" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_userId_idx" ON "Invitation"("userId");

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- L'invitation survit au départ de qui l'a envoyée : le nouveau venu doit pouvoir activer
-- son compte même si l'administrateur qui l'a invité a quitté le studio entre-temps.
ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
