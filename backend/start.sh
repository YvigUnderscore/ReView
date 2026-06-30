#!/bin/sh
set -e

echo "Génération du client Prisma..."
npx prisma generate

# Applique les migrations versionnées ; à défaut (aucune migration committée),
# synchronise le schéma directement (greenfield, dev).
echo "Application du schéma de base de données..."
npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss

echo "Démarrage de l'application..."
exec node dist/server.js
