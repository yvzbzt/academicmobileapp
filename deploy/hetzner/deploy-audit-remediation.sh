#!/usr/bin/env bash
set -Eeuo pipefail

release_id="${1:-}"
if [[ ! "${release_id}" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Usage: $0 <git-commit>" >&2
  exit 64
fi

project_root="/opt/anssoft-academicmobilapp-backend"
release_root="${project_root}/releases/${release_id}"
source_root="${release_root}/source"
release_archive="${release_root}/source.tar.gz"
compose_file="${project_root}/compose.yaml"
compose_source="${source_root}/deploy/hetzner/compose.yaml"
env_file="${project_root}/.env"
api_container="anssoft-backend"
worker_container="anssoft-content-worker"
mongo_container="anssoft-mongodb"
caddy_container="anssoft-tenant-edge-caddy-1"
caddy_route="/home/ans/docker/caddy/custom-domains/academic-api.anssoft.com.tr.caddy"
route_source="${source_root}/deploy/hetzner/admin/academic-api.anssoft.com.tr.caddy"
release_commit_file="${release_root}/release.commit"
release_checksum_file="${release_root}/source.archive.sha256"
new_image="anssoft-backend:audit-${release_id}"
canary="anssoft-backend-canary-audit-${release_id}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${project_root}/backups/audit-${release_id}-${timestamp}"
source_staging="${project_root}/source.${release_id}.staging"
source_backup="${backup_root}/source.before"

for required in \
  "${release_archive}" \
  "${release_commit_file}" \
  "${release_checksum_file}" \
  "${compose_file}" \
  "${env_file}" \
  "${caddy_route}"; do
  [[ -e "${required}" ]]
done
[[ "$(cat "${release_commit_file}")" == "${release_id}" ]]
grep -Eq '^[a-f0-9]{64}  source\.tar\.gz$' "${release_checksum_file}"
(
  cd "${release_root}"
  sha256sum --check --strict source.archive.sha256
)

[[ ! -e "${source_root}" ]]
archive_entries="$(tar -tzf "${release_archive}")"
[[ -n "${archive_entries}" ]]
while IFS= read -r archive_entry; do
  case "${archive_entry}" in
    source|source/*) ;;
    *)
      echo "Archive entry escapes the expected source root: ${archive_entry}" >&2
      exit 65
      ;;
  esac
  case "/${archive_entry}/" in
    */../*|*/./*)
      echo "Archive entry contains an unsafe path segment: ${archive_entry}" >&2
      exit 65
      ;;
  esac
done <<< "${archive_entries}"
mkdir -m 700 "${source_root}"
tar -xzf "${release_archive}" --strip-components=1 -C "${source_root}"
[[ -z "$(find "${source_root}" -type l -print -quit)" ]]

for required_source in \
  "${source_root}/package-lock.json" \
  "${source_root}/deploy/hetzner/Dockerfile.api" \
  "${compose_source}" \
  "${route_source}"; do
  [[ -f "${required_source}" ]]
done

[[ "$(docker inspect --format '{{.State.Health.Status}}' "${api_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${mongo_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]

mongo_id="$(docker inspect --format '{{.Id}}' "${mongo_container}")"
caddy_id="$(docker inspect --format '{{.Id}}' "${caddy_container}")"
caddy_started_at="$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")"
caddy_restart_count="$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")"
old_image_id="$(docker inspect --format '{{.Image}}' "${api_container}")"
live_image="$(docker inspect --format '{{.Config.Image}}' "${api_container}")"
[[ "${live_image}" == anssoft-backend:* ]]
worker_existed=false
worker_was_running=false
worker_old_image_id=""
worker_live_image=""
if docker container inspect "${worker_container}" >/dev/null 2>&1; then
  worker_existed=true
  worker_was_running="$(docker inspect --format '{{.State.Running}}' "${worker_container}")"
  worker_old_image_id="$(docker inspect --format '{{.Image}}' "${worker_container}")"
  worker_live_image="$(docker inspect --format '{{.Config.Image}}' "${worker_container}")"
fi

mkdir -p "${backup_root}"
install -m 600 "${compose_file}" "${backup_root}/compose.yaml"
install -m 640 "${caddy_route}" "${backup_root}/academic-api.anssoft.com.tr.caddy"
printf '%s\n' "${old_image_id}" > "${backup_root}/api-image-id.txt"

image_retagged=false
api_recreated=false
worker_recreated=false
route_reloaded=false
source_swapped=false
compose_installed=false

rollback() {
  local exit_code="${1:-$?}"
  trap - ERR INT TERM
  set +e
  echo "Audit remediation failed; restoring this project's API, worker, and route." >&2
  docker rm -f "${canary}" >/dev/null 2>&1
  if [[ "${worker_recreated}" == "true" ]]; then
    docker rm -f "${worker_container}" >/dev/null 2>&1
  fi

  if [[ "${source_swapped}" == "true" ]]; then
    if [[ -d "${project_root}/source" ]]; then
      mv "${project_root}/source" "${backup_root}/source.failed" >/dev/null 2>&1
    fi
    if [[ -d "${source_backup}" ]]; then
      mv "${source_backup}" "${project_root}/source" >/dev/null 2>&1
    fi
  fi

  if [[ "${route_reloaded}" == "true" ]]; then
    install -m 640 -o ans -g ans \
      "${backup_root}/academic-api.anssoft.com.tr.caddy" "${caddy_route}.rollback"
    mv -f "${caddy_route}.rollback" "${caddy_route}"
    docker exec "${caddy_container}" \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
    docker exec "${caddy_container}" \
      caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
  fi

  if [[ "${compose_installed}" == "true" ]]; then
    install -m 600 "${backup_root}/compose.yaml" "${compose_file}.rollback"
    mv -f "${compose_file}.rollback" "${compose_file}"
  fi

  if [[ "${image_retagged}" == "true" ]]; then
    docker image tag "${old_image_id}" "${live_image}"
  fi
  if [[ "${api_recreated}" == "true" ]]; then
    docker compose --env-file "${env_file}" -f "${compose_file}" \
      up -d --no-deps --force-recreate api >/dev/null 2>&1
    for _ in $(seq 1 30); do
      if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${api_container}" 2>/dev/null)" == "healthy" ]]; then
        break
      fi
      sleep 5
    done
  fi
  if [[ "${worker_recreated}" == "true" ]]; then
    if [[ "${worker_existed}" == "true" ]]; then
      docker image tag "${worker_old_image_id}" "${worker_live_image}" >/dev/null 2>&1
      docker compose --env-file "${env_file}" -f "${compose_file}" \
        up -d --pull never --no-deps --force-recreate content-worker >/dev/null 2>&1
      if [[ "${worker_live_image}" == "${live_image}" ]]; then
        docker image tag "${old_image_id}" "${live_image}" >/dev/null 2>&1
      fi
      worker_rollback_running=false
      for _ in $(seq 1 15); do
        if [[ "$(docker inspect --format '{{.State.Running}}' "${worker_container}" 2>/dev/null)" == "true" ]]; then
          worker_rollback_running=true
          break
        fi
        sleep 2
      done
      if [[ "${worker_was_running}" == "false" ]]; then
        docker stop "${worker_container}" >/dev/null 2>&1
      fi
      worker_rollback_running="$(docker inspect --format '{{.State.Running}}' "${worker_container}" 2>/dev/null)"
      if [[ "${worker_rollback_running}" != "${worker_was_running}" ]] \
        || [[ "$(docker inspect --format '{{.Image}}' "${worker_container}" 2>/dev/null)" != "${worker_old_image_id}" ]]; then
        echo "Rollback could not restore the previous content worker." >&2
      fi
    elif docker container inspect "${worker_container}" >/dev/null 2>&1; then
      echo "Rollback could not remove the rejected content worker." >&2
    fi
  fi
  [[ "$(docker inspect --format '{{.Id}}' "${mongo_container}" 2>/dev/null)" == "${mongo_id}" ]]
  exit "${exit_code}"
}
trap rollback ERR
trap 'rollback 130' INT TERM

docker build --pull=false --build-arg "APP_RELEASE_COMMIT=${release_id}" -f "${source_root}/deploy/hetzner/Dockerfile.api" \
  -t "${new_image}" "${source_root}"
docker image tag "${new_image}" "${live_image}"
image_retagged=true
install -m 600 "${compose_source}" "${compose_file}.tmp"
mv -f "${compose_file}.tmp" "${compose_file}"
compose_installed=true
docker compose --env-file "${env_file}" -f "${compose_file}" config --quiet

if docker container inspect "${canary}" >/dev/null 2>&1; then
  echo "Refusing to reuse existing canary container ${canary}." >&2
  false
fi
docker compose --env-file "${env_file}" -f "${compose_file}" run -d \
  --name "${canary}" --no-deps api >/dev/null
for _ in $(seq 1 60); do
  if docker exec "${canary}" node -e \
    "fetch('http://127.0.0.1:3000/health/ready').then(async r=>{const b=await r.json();process.exit(r.ok&&b.status==='ok'&&Object.keys(b).length===1?0:2)}).catch(()=>process.exit(3))"; then
    break
  fi
  sleep 1
done
docker exec "${canary}" node -e \
  "fetch('http://127.0.0.1:3000/calendar/integrations/feed/%25.ics').then(r=>process.exit(r.status===401?0:2)).catch(()=>process.exit(3))"
canary_critical_log_count="$(docker logs "${canary}" 2>&1 | grep -Eic 'uncaught|unhandled|fatal|ENVIRONMENT_INVALID' || true)"
[[ "${canary_critical_log_count}" -eq 0 ]]
docker rm -f "${canary}" >/dev/null

api_recreated=true
docker compose --env-file "${env_file}" -f "${compose_file}" \
  up -d --no-deps --force-recreate api >/dev/null
for _ in $(seq 1 30); do
  if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${api_container}")" == "healthy" ]]; then
    break
  fi
  sleep 5
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${api_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.Id}}' "${mongo_container}")" == "${mongo_id}" ]]

worker_recreated=true
docker compose --env-file "${env_file}" -f "${compose_file}" \
  up -d --no-deps --force-recreate content-worker >/dev/null
worker_ready=false
for _ in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "${worker_container}" 2>/dev/null)" == "true" ]] \
    && docker logs "${worker_container}" 2>&1 | grep -Fq 'CONTENT_INGESTION_WORKER_READY'; then
    worker_ready=true
    break
  fi
  sleep 1
done
[[ "${worker_ready}" == "true" ]]
[[ "$(docker inspect --format '{{.Image}}' "${worker_container}")" == "$(docker inspect --format '{{.Image}}' "${api_container}")" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${worker_container}")" == "0" ]]
[[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${api_container}")" == "${release_id}" ]]
[[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${worker_container}")" == "${release_id}" ]]
worker_environment="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${worker_container}")"
grep -Fxq 'CONTENT_INGESTION_WORKER_ENABLED=true' <<< "${worker_environment}"
grep -Fxq 'ANNOUNCEMENT_HEALTH_PROBE_ENABLED=true' <<< "${worker_environment}"
grep -Fxq 'ANNOUNCEMENT_DEVICE_REVISION_ENABLED=true' <<< "${worker_environment}"
grep -Fxq 'CALENDAR_AUTO_INGEST_ENABLED=true' <<< "${worker_environment}"
worker_critical_log_count="$(docker logs "${worker_container}" 2>&1 | grep -Eic 'uncaught|unhandled|fatal|ENVIRONMENT_INVALID' || true)"
[[ "${worker_critical_log_count}" -eq 0 ]]

install -m 640 -o ans -g ans "${route_source}" "${caddy_route}.tmp"
mv -f "${caddy_route}.tmp" "${caddy_route}"
route_reloaded=true
docker exec "${caddy_container}" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "${caddy_container}" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "${caddy_restart_count}" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]

health_body="$(curl --fail --silent --show-error https://academic-api.anssoft.com.tr/health/ready)"
[[ "${health_body}" == '{"status":"ok"}' ]]
hsts_header="$(curl --silent --show-error --head https://academic-api.anssoft.com.tr/health/live | tr -d '\r' | grep -i '^strict-transport-security:')"
[[ -n "${hsts_header}" ]]

critical_log_count="$(docker logs --since 5m "${api_container}" 2>&1 | grep -Eic 'uncaught|unhandled|fatal|ENVIRONMENT_INVALID' || true)"
[[ "${critical_log_count}" -eq 0 ]]

[[ ! -e "${source_staging}" ]]
cp -a "${source_root}" "${source_staging}"
mv "${project_root}/source" "${source_backup}"
source_swapped=true
mv "${source_staging}" "${project_root}/source"
printf '%s\n' "${release_id}" > "${project_root}/deployed-commit.txt"
date --iso-8601=seconds > "${project_root}/deployed-at.txt"
chmod 600 "${project_root}/deployed-commit.txt" "${project_root}/deployed-at.txt"

trap - ERR INT TERM
echo "AUDIT_REMEDIATION_DEPLOYMENT_OK"
echo "RELEASE=${release_id}"
echo "BACKUP=${backup_root}"
