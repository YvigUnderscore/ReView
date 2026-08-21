# Build du frontend. Contexte docker = racine du repo (voir docker-compose.yml) :
# le script prebuild (scripts/build-docs.mjs) copie DOCUMENTATION/ dans public/docs.
# Node 22 requis par Vite 7 (Node 18 n'est plus supporté).
FROM node:22-alpine AS build

WORKDIR /app/frontend

# Dépendances (couche cache)
COPY frontend/package*.json ./
RUN npm install

# Sources frontend + documentation produit (embarquée sur /docs)
COPY frontend/ ./
COPY DOCUMENTATION/ ../DOCUMENTATION/

RUN npm run build

# Stage 2: Serve the application with Nginx
# Version épinglée (et alignée sur le proxy TLS de docker-compose.prod.yml) : `alpine`
# seul suit la branche courante, et une majeure nginx peut changer le comportement de
# `location`/`add_header` sur lequel repose frontend/nginx.conf.
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="ReView (frontend)" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/YvigUnderscore/ReView"

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Le bundle servi ici agrège des dépendances MIT/BSD/ISC minifiées : leurs notices doivent
# accompagner la redistribution, et l'AGPL §13 veut que le code correspondant soit offert à
# quiconque utilise l'instance. Les deux fichiers sont donc servis avec l'application.
COPY LICENSE THIRD-PARTY-NOTICES.md /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
