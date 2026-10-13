# Build context is the verified four-module overlay, not the repository.
# BASE_IMAGE must be a local tag of the inspected immutable production image.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.revision=${RELEASE_COMMIT}
LABEL tr.anssoft.source-hotfix="selcuk-empty-stale-preview"
COPY --chown=node:node dist/ /app/dist/
COPY --chown=node:node manifest.json /app/source-hotfix-manifest.json
COPY --chown=node:node verify-admin-source-hotfix.mjs /app/deploy/hetzner/verify-admin-source-hotfix.mjs
