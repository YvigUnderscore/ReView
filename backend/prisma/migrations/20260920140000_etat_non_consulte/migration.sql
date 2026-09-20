-- État « non consulté » (Phase 50, lot 9) : horodatage de visite par personne et par entité.
--
-- Une seule table pour les huit niveaux (projet, séquence, plan, asset, tâche, média,
-- playlist, board) : le couple (type, id) évite huit colonnes dont sept seraient nulles.
-- Les huit valeurs du type énuméré sont posées d'emblée — en ajouter une plus tard
-- demanderait une migration de plus pour rien.

-- CreateEnum
CREATE TYPE "VisitTargetType" AS ENUM ('PROJECT', 'SEQUENCE', 'SHOT', 'ASSET', 'TASK', 'MEDIA', 'PLAYLIST', 'BOARD');

-- CreateTable
CREATE TABLE "EntityVisit" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "targetType" "VisitTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- L'unique EST l'index de lecture : la seule requête jouée est « les visites de cette
-- personne, pour ce type, parmi les ids de la page » — soit `"userId" = $1 AND
-- "targetType" = $2 AND "targetId" = ANY($3)`, que le préfixe gauche sert en entier.
-- Un index ("userId", "targetType") de plus ne serait jamais choisi et se paierait à
-- chaque écriture ; ce schéma a déjà eu à retirer de tels index (cf. `MediaObject`).
CREATE UNIQUE INDEX "EntityVisit_userId_targetType_targetId_key" ON "EntityVisit"("userId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "EntityVisit" ADD CONSTRAINT "EntityVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
