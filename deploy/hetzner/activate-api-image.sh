#!/usr/bin/env bash
set -euo pipefail

deployment_root="/opt/anssoft-academicmobilapp-backend"
archive_name="anssoft-backend-source-20260717.tar.gz"
expected_archive_sha256="${1:?Expected source archive SHA-256 is required}"
source "${deployment_root}/api-network-probe.sh"

resolved_root="$(readlink -f "${deployment_root}")"
if [[ "${resolved_root}" != "${deployment_root}" ]]; then
  echo "Unexpected deployment root: ${resolved_root}" >&2
  exit 1
fi

cd "${deployment_root}"

actual_archive_sha256="$(sha256sum "${archive_name}" | awk '{print toupper($1)}')"
if [[ "${actual_archive_sha256}" != "${expected_archive_sha256^^}" ]]; then
  echo "Source archive checksum mismatch." >&2
  exit 1
fi

tar -xzf "${archive_name}" -C source
test -f source/package-lock.json
test -f source/deploy/hetzner/Dockerfile.api

mongo_id_before="$(docker inspect --format '{{.Id}}' anssoft-mongodb)"
docker image tag anssoft-backend:2026-07-17 anssoft-backend:rollback-before-query-fix
docker compose --env-file .env -f compose.yaml build api
docker compose --env-file .env -f compose.yaml up -d --no-deps --force-recreate api

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' anssoft-backend)"
  echo "API health: ${status}"
  if [[ "${status}" == "healthy" ]]; then
    break
  fi
  sleep 10
done

test "$(docker inspect --format '{{.State.Health.Status}}' anssoft-backend)" = "healthy"
test "$(docker inspect --format '{{.Id}}' anssoft-mongodb)" = "${mongo_id_before}"

api_get "/universities?limit=2" |
  python3 -c '
import json
import sys

rows = json.load(sys.stdin)
assert isinstance(rows, list) and len(rows) == 2
assert all(isinstance(row.get("id"), str) and row["id"] for row in rows)
print("Numeric query conversion and stable catalog IDs: ok")
'

sha256sum \
  "${archive_name}" \
  compose.yaml \
  mongo-init.js \
  Caddyfile.proposed \
  caddy-compose.with-academic-edge.yml \
  api-network-probe.sh \
  provision-secrets.sh \
  activate-api-image.sh > deployment-files.sha256
date --iso-8601=seconds > deployed-at.txt

echo "API image activation: complete"
