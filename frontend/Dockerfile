# Frontend build. The docker context is the repo root (see docker-compose.yml): the prebuild
# script (frontend/scripts/build-docs.mjs) copies DOCUMENTATION/ into public/docs.
# Node 22 is required by Vite 7.
FROM node:22-alpine AS build

WORKDIR /app/frontend

# Dependencies (cached layer)
COPY frontend/package*.json ./
RUN npm install

# Frontend sources + product documentation (served in-app on /docs)
COPY frontend/ ./
COPY DOCUMENTATION/ ../DOCUMENTATION/

RUN npm run build

# Stage 2: Serve the application with Nginx
# Pinned version, aligned with the TLS proxy in docker-compose.prod.yml: plain `alpine`
# follows the mainline branch, and a new nginx major can change the `location`/`add_header`
# behaviour that frontend/nginx.conf relies on.
FROM nginx:1.27-alpine

# Same build-args as the backend image: `release.yml` passes them to all three images, and an
# undeclared build-arg is silently ignored. Here they only label the image, so that a running
# container can tell which version it comes from.
ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_DATE=

LABEL org.opencontainers.image.title="ReView (frontend)" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/YvigUnderscore/ReView" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# The bundle served here aggregates minified MIT/BSD/ISC dependencies: their notices must
# accompany redistribution, and AGPL §13 requires the corresponding source to be offered to
# anyone using the instance. Both files are therefore served with the application.
COPY LICENSE THIRD-PARTY-NOTICES.md /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
