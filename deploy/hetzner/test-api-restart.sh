#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/api-network-probe.sh"
api_id_before="$(docker inspect --format '{{.Id}}' anssoft-backend)"
mongo_id_before="$(docker inspect --format '{{.Id}}' anssoft-mongodb)"
restart_count_before="$(docker inspect --format '{{.RestartCount}}' anssoft-backend)"

set +e
docker exec anssoft-backend sh -ec 'kill -9 $(pidof node)' >/dev/null 2>&1
set -e

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' anssoft-backend)"
  echo "API recovery health: ${status}"
  if [[ "${status}" == "healthy" ]]; then
    break
  fi
  sleep 10
done

[[ "$(docker inspect --format '{{.Id}}' anssoft-backend)" == "${api_id_before}" ]]
[[ "$(docker inspect --format '{{.Id}}' anssoft-mongodb)" == "${mongo_id_before}" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' anssoft-backend)" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' anssoft-mongodb)" == "healthy" ]]

restart_count_after="$(docker inspect --format '{{.RestartCount}}' anssoft-backend)"
if (( restart_count_after <= restart_count_before )); then
  echo "API restart count did not increase." >&2
  exit 1
fi

api_get "/health/ready" >/dev/null
echo "API automatic crash recovery: passed (${restart_count_before} -> ${restart_count_after})"
