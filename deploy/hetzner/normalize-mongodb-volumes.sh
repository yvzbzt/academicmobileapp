#!/usr/bin/env bash
set -euo pipefail

deployment_root="/opt/anssoft-academicmobilapp-backend"
source "${deployment_root}/api-network-probe.sh"

cd "${deployment_root}"
docker compose --env-file .env -f compose.yaml config --quiet

api_id_before="$(docker inspect --format '{{.Id}}' anssoft-backend)"
data_mountpoint_before="$(docker volume inspect --format '{{.Mountpoint}}' anssoft-mongodb-data)"
anonymous_config_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/configdb"}}{{.Name}}{{end}}{{end}}' anssoft-mongodb)"

if [[ -z "${anonymous_config_volume}" || "${anonymous_config_volume}" == "anssoft-mongodb-config" ]]; then
  echo "Expected an anonymous MongoDB config volume before normalization." >&2
  exit 1
fi
docker volume inspect "${anonymous_config_volume}" >/dev/null

docker compose --env-file .env -f compose.yaml up -d --no-deps --force-recreate mongodb

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  mongo_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' anssoft-mongodb)"
  echo "MongoDB health after volume normalization: ${mongo_health}"
  if [[ "${mongo_health}" == "healthy" ]]; then
    break
  fi
  sleep 10
done

[[ "$(docker inspect --format '{{.State.Health.Status}}' anssoft-mongodb)" == "healthy" ]]
[[ "$(docker inspect --format '{{.Id}}' anssoft-backend)" == "${api_id_before}" ]]
[[ "$(docker volume inspect --format '{{.Mountpoint}}' anssoft-mongodb-data)" == "${data_mountpoint_before}" ]]

docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' anssoft-mongodb |
  grep -Fq 'anssoft-mongodb-data /data/db'
docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' anssoft-mongodb |
  grep -Fq 'anssoft-mongodb-config /data/configdb'

api_get "/health/ready" >/dev/null
docker volume rm "${anonymous_config_volume}"

echo "MongoDB volume normalization: complete"
