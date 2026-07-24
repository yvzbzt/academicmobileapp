#!/usr/bin/env bash
set -Eeuo pipefail

deployment_root="/opt/anssoft-academicmobilapp-backend"
caddy_root="/home/ans/docker/caddy"
staging_root="${deployment_root}/staging-academic-edge"
network_name="anssoft-academic-edge"
network_subnet="172.30.79.0/24"
caddy_container="anssoft-tenant-edge-caddy-1"
api_container="anssoft-backend"
mongo_container="anssoft-mongodb"

expected_api_compose_sha256="463307d2715a844612bbb0c65b18b50f3994a75240fed77ca7ee160c35d11ebc"
expected_caddy_compose_sha256="de4c3e1077f2ff278e214f63ca4eea55c80173bb7686708f211b8116790dd167"
expected_staged_api_compose_sha256="de3ad4851e9596ad780c6a67007c2ac0a5a8a3b6ed6e698a93c5ee013b3c3486"
expected_staged_caddy_compose_sha256="e65f04a601ce54e011f31f660f9dde62f717091a6136a4ead07bdae84bf76612"
expected_caddy_id="d37e90152ad7dcf3b7f0942d301ac1c5d3cf33da020a71bcc440218c2b5b3eea"
expected_caddy_started_at="2026-06-17T11:31:54.187759883Z"

network_created=false
caddy_connected=false
api_recreated=false
caddy_compose_installed=false
support_files_installed=false
backup_root=""

existing_support_files=(
  Caddyfile.proposed
  activate-api-image.sh
  validate-deployment.sh
  test-api-restart.sh
  test-mongodb-persistence.sh
  normalize-mongodb-volumes.sh
  capture-post-deployment.sh
  verify-existing-resources.sh
)

new_support_files=(
  caddy-compose.with-academic-edge.yml
  api-network-probe.sh
)

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

wait_for_health() {
  local container="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))
  local status

  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container}")"
    echo "${container} health: ${status}"
    [[ "${status}" == "healthy" ]] && return 0
    sleep 5
  done

  return 1
}

restore_with_reference() {
  local source="$1"
  local target="$2"
  local temporary="${target}.academic-edge-rollback"

  cp "${source}" "${temporary}"
  chown --reference="${target}" "${temporary}"
  chmod --reference="${target}" "${temporary}"
  mv -f "${temporary}" "${target}"
}

rollback() {
  local exit_code=$?
  local failed_line="${BASH_LINENO[0]:-unknown}"
  local failed_command="${BASH_COMMAND:-unknown}"
  trap - ERR
  echo "Migration failed at line ${failed_line}: ${failed_command}" >&2
  echo "Restoring the previous topology." >&2

  if [[ "${caddy_compose_installed}" == "true" && -n "${backup_root}" ]]; then
    restore_with_reference "${backup_root}/caddy-compose.yml" "${caddy_root}/compose.yml" || true
  fi

  if [[ "${api_recreated}" == "true" && -n "${backup_root}" ]]; then
    restore_with_reference "${backup_root}/academic-compose.yaml" "${deployment_root}/compose.yaml" || true
    (
      cd "${deployment_root}"
      docker compose --env-file .env -f compose.yaml up -d --no-deps --force-recreate api
    ) || true
    wait_for_health "${api_container}" 180 || true
  fi

  if [[ "${support_files_installed}" == "true" && -n "${backup_root}" ]]; then
    for file in "${existing_support_files[@]}"; do
      restore_with_reference "${backup_root}/${file}" "${deployment_root}/${file}" || true
    done
    for file in "${new_support_files[@]}"; do
      rm -f -- "${deployment_root:?}/${file}" || true
    done
  fi

  if [[ "${caddy_connected}" == "true" ]]; then
    docker network disconnect "${network_name}" "${caddy_container}" || true
  fi

  if [[ "${network_created}" == "true" ]]; then
    docker network rm "${network_name}" || true
  fi

  exit "${exit_code}"
}

trap rollback ERR

[[ "$(readlink -f "${deployment_root}")" == "${deployment_root}" ]]
[[ "$(sha256_of "${deployment_root}/compose.yaml")" == "${expected_api_compose_sha256}" ]]
[[ "$(sha256_of "${caddy_root}/compose.yml")" == "${expected_caddy_compose_sha256}" ]]
[[ "$(sha256_of "${staging_root}/compose.yaml")" == "${expected_staged_api_compose_sha256}" ]]
[[ "$(sha256_of "${staging_root}/caddy-compose.with-academic-edge.yml")" == "${expected_staged_caddy_compose_sha256}" ]]
[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${expected_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${api_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${mongo_container}")" == "healthy" ]]
[[ -z "$(docker network ls --quiet --filter "name=^${network_name}$")" ]]
for file in "${new_support_files[@]}"; do
  [[ ! -e "${deployment_root}/${file}" ]]
done

bash -n "${staging_root}"/*.sh
docker compose --env-file "${deployment_root}/.env" \
  -f "${staging_root}/compose.yaml" config --quiet
docker compose --env-file "${caddy_root}/.env" \
  -f "${staging_root}/caddy-compose.with-academic-edge.yml" config --quiet

timestamp="$(date +%Y%m%dT%H%M%S%z)"
backup_root="${deployment_root}/backups/academic-edge-${timestamp}"
install -d -m 700 "${backup_root}"
cp -a "${deployment_root}/compose.yaml" "${backup_root}/academic-compose.yaml"
cp -a "${caddy_root}/compose.yml" "${backup_root}/caddy-compose.yml"
for file in "${existing_support_files[@]}"; do
  cp -a "${deployment_root}/${file}" "${backup_root}/${file}"
done
printf '%s\n' "${backup_root}" > "${deployment_root}/academic-edge-backup-path.txt"
chmod 600 "${deployment_root}/academic-edge-backup-path.txt"

mongo_id_before="$(docker inspect --format '{{.Id}}' "${mongo_container}")"

docker network create \
  --driver bridge \
  --internal \
  --subnet "${network_subnet}" \
  --label com.anssoft.owner=academic-mobile-app \
  --label com.anssoft.purpose=caddy-api-proxy \
  "${network_name}" >/dev/null
network_created=true

docker network connect \
  --alias caddy \
  --gw-priority -1 \
  "${network_name}" \
  "${caddy_container}"
caddy_connected=true

echo "Checkpoint: dedicated network attached to Caddy"
[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${expected_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{(index .NetworkSettings.Networks "edge").GwPriority}}' "${caddy_container}")" == "0" ]]
[[ "$(docker inspect --format '{{(index .NetworkSettings.Networks "anssoft-academic-edge").GwPriority}}' "${caddy_container}")" == "-1" ]]
docker exec "${caddy_container}" wget -qO- http://127.0.0.1:8080/healthz >/dev/null

restore_with_reference "${staging_root}/compose.yaml" "${deployment_root}/compose.yaml"
api_recreated=true
(
  cd "${deployment_root}"
  docker compose --env-file .env -f compose.yaml up -d --no-deps --force-recreate api
)
wait_for_health "${api_container}" 180

echo "Checkpoint: Academic API recreated and healthy"
[[ "$(docker inspect --format '{{.Id}}' "${mongo_container}")" == "${mongo_id_before}" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${mongo_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]
[[ -z "$(docker port "${api_container}" 2>/dev/null || true)" ]]
! ss -lntH | awk '{print $4}' | grep -Eq '(^|:)18080$'
echo "Checkpoint: host port 18080 removed"

api_networks="$(docker inspect --format '{{range $name, $config := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${api_container}" |
  sed '/^[[:space:]]*$/d' |
  sort)"
echo "API networks:"
printf '%s\n' "${api_networks}"
[[ "${api_networks}" == $'anssoft-academic-edge\nanssoft-egress\nanssoft-internal' ]]
proxy_members="$(docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' "${network_name}" |
  sed '/^[[:space:]]*$/d' |
  sort)"
echo "Proxy network members:"
printf '%s\n' "${proxy_members}"
[[ "${proxy_members}" == $'anssoft-backend\nanssoft-tenant-edge-caddy-1' ]]

docker exec "${caddy_container}" wget -qO- \
  http://academic-api:3000/health/ready >/dev/null
echo "Checkpoint: Caddy resolved academic-api and reached port 3000"
docker exec "${api_container}" node -e "
  fetch('https://oauth2.googleapis.com/tokeninfo?id_token=anssoft-connectivity-check')
    .then((response) => {
      if (![400, 401].includes(response.status)) process.exit(2);
    })
    .catch(() => process.exit(3));
"
echo "Checkpoint: Academic API outbound connectivity preserved"

for file in \
  Caddyfile.proposed \
  caddy-compose.with-academic-edge.yml; do
  install -m 600 "${staging_root}/${file}" "${deployment_root}/${file}"
done

for file in \
  api-network-probe.sh \
  activate-api-image.sh \
  validate-deployment.sh \
  test-api-restart.sh \
  test-mongodb-persistence.sh \
  normalize-mongodb-volumes.sh \
  capture-post-deployment.sh \
  verify-existing-resources.sh; do
  install -m 700 "${staging_root}/${file}" "${deployment_root}/${file}"
done
support_files_installed=true

restore_with_reference \
  "${staging_root}/caddy-compose.with-academic-edge.yml" \
  "${caddy_root}/compose.yml"
caddy_compose_installed=true

(
  cd "${caddy_root}"
  docker compose --env-file .env -f compose.yml config --quiet
)
[[ "$(sha256_of "${caddy_root}/compose.yml")" == "${expected_staged_caddy_compose_sha256}" ]]
[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${expected_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]

"${deployment_root}/validate-deployment.sh"
"${deployment_root}/verify-existing-resources.sh"

sha256sum \
  "${deployment_root}/anssoft-backend-source-20260717.tar.gz" \
  "${deployment_root}/compose.yaml" \
  "${deployment_root}/mongo-init.js" \
  "${deployment_root}/Caddyfile.proposed" \
  "${deployment_root}/caddy-compose.with-academic-edge.yml" \
  "${deployment_root}/api-network-probe.sh" \
  "${deployment_root}/provision-secrets.sh" \
  "${deployment_root}/activate-api-image.sh" \
  "${deployment_root}/validate-deployment.sh" \
  "${deployment_root}/verify-existing-resources.sh" \
  > "${deployment_root}/deployment-files.sha256"
date --iso-8601=seconds > "${deployment_root}/academic-edge-migrated-at.txt"
chmod 600 \
  "${deployment_root}/deployment-files.sha256" \
  "${deployment_root}/academic-edge-migrated-at.txt"

trap - ERR
echo "Academic proxy-network migration: complete"
echo "Rollback backup: ${backup_root}"
