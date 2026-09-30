# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

# ReView ops agent: the image that carries out orders issued from the administration UI.
#
# Deliberately tiny (~40 MB) and deliberately SEPARATE from the product images: it holds the
# docker socket, the equivalent of root on the host. The less it ships, the less there is to
# audit. No Node, nothing from the product, no npm dependency: bash, jq, git, coreutils, and
# the docker client.
#
# Pinned version (never `:latest`): two studios installing the agent on different dates must
# run the same docker client, since it is what talks to their machine's daemon.
FROM docker:27.5.1-cli

# `coreutils` is not a convenience: `sort -V` (version comparison) and `date -d` (parsing an
# ISO timestamp) are missing from Alpine's busybox applets, and the downgrade refusal and
# order expiry rely on them.
# `git` is used by build mode (`git checkout <tag>`).
RUN apk add --no-cache bash jq git coreutils tzdata

# The loop is BAKED into the image, not read from the mounted repository: in build mode,
# `update.sh` changes the repository's version WHILE the agent runs. An agent read from the
# bind mount would be rewritten underneath itself in the middle of an update.
COPY agent.sh /opt/review-ops/agent.sh
RUN chmod +x /opt/review-ops/agent.sh

ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_DATE=
ENV OPS_AGENT_VERSION=$APP_VERSION

LABEL org.opencontainers.image.title="ReView (ops agent)" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/YvigUnderscore/ReView" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"

ENTRYPOINT ["/bin/bash", "/opt/review-ops/agent.sh"]
