# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

# Agent d'exploitation ReView — l'image qui exécute les ordres de l'administration.
#
# Volontairement minuscule (~40 Mo) et volontairement SÉPARÉE des images du produit : elle
# détient le socket docker, c'est-à-dire l'équivalent de root sur la machine hôte. Moins
# elle embarque, moins il y a à auditer. Rien de Node, rien du produit, aucune dépendance
# npm : bash, jq, git, coreutils, et le client docker.
#
# Version épinglée (jamais `:latest`) : deux studios qui installent l'agent à deux dates
# doivent exécuter le même client docker — c'est lui qui parle au démon de leur machine.
FROM docker:27.5.1-cli

# `coreutils` n'est pas un confort : `sort -V` (comparaison de versions) et `date -d`
# (lecture d'un horodatage ISO) n'existent pas dans les applets busybox d'Alpine, et c'est
# sur eux que reposent le refus de rétrogradation et la péremption d'un ordre.
# `git` sert au mode construction (`git checkout <étiquette>`).
RUN apk add --no-cache bash jq git coreutils tzdata

COPY agent.sh /opt/review-ops/agent.sh
RUN chmod +x /opt/review-ops/agent.sh

# La boucle est EMBARQUÉE dans l'image, pas lue depuis le dépôt monté : en mode
# construction, `update.sh` change la version du dépôt PENDANT que l'agent tourne. Un agent
# lu depuis le bind mount se ferait réécrire sous lui-même, au milieu d'une mise à jour.
ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_DATE=
ENV OPS_AGENT_VERSION=$APP_VERSION

LABEL org.opencontainers.image.title="ReView (agent d'exploitation)" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/YvigUnderscore/ReView" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"

ENTRYPOINT ["/bin/bash", "/opt/review-ops/agent.sh"]
