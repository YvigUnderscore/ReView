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
FROM nginx:alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
