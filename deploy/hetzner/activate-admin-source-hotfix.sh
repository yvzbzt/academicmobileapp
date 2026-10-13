#!/usr/bin/env bash
# API + content-worker only. Subsequent Compose operations must include the
# release's source-hotfix/compose.yaml; omitting it restores the old image.
set -Eeuo pipefail
umask 077

release_id="${1:-}"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]] || { echo "Usage: $0 <full-40-character-commit>" >&2; exit 64; }
project_root="/opt/anssoft-academicmobilapp-backend"
release_root="${project_root}/releases/${release_id}/source-hotfix"
new_image="anssoft-backend:source-hotfix-${release_id}"
old_image="anssoft-backend:calendar-muse-b5173e224e79"
expected_old_id="sha256:919ddf7eed2a49588d228b98691a6c085bf4e7e2161df3278148bda9696c143f"
api="anssoft-backend"
worker="anssoft-content-worker"
compose=(docker compose --project-name anssoft-backend --project-directory "${project_root}" --env-file "${project_root}/.env" -f "${project_root}/compose.yaml" -f "${project_root}/compose.muse.yaml")

[[ "$(readlink -f "${project_root}")" == "${project_root}" ]]
[[ "$(readlink -m "${release_root}")" == "${release_root}" ]]
[[ ! -e "${release_root}" ]]
for configuration in compose.yaml compose.muse.yaml .env; do
  [[ -f "${project_root}/${configuration}" && ! -L "${project_root}/${configuration}" ]]
done
[[ "$(docker image inspect --format '{{.Id}}' "${old_image}")" == "${expected_old_id}" ]]
new_id="$(docker image inspect --format '{{.Id}}' "${new_image}")"
[[ "${new_id}" != "${expected_old_id}" ]]
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${new_image}")" == "${release_id}" ]]
# An overlay must retain every existing filesystem layer and runtime command.
old_layers="$(docker image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' "${old_image}")"
new_layers="$(docker image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' "${new_image}")"
[[ "${new_layers}" == "${old_layers}"$'\n'* ]]
image_runtime='{{.Config.User}} {{json .Config.Entrypoint}} {{json .Config.Cmd}}'
[[ "$(docker image inspect --format "${image_runtime}" "${new_image}")" == "$(docker image inspect --format "${image_runtime}" "${old_image}")" ]]
for container in "${api}" "${worker}"; do
  [[ "$(docker inspect --format '{{.Image}}' "${container}")" == "${expected_old_id}" ]]
  [[ "$(docker inspect --format '{{.State.Running}}' "${container}")" == "true" ]]
  [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "${container}")" == "anssoft-backend" ]]
done
[[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "${api}")" == "api" ]]
[[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "${worker}")" == "content-worker" ]]
for container in "${api}" anssoft-mongodb anssoft-tenant-edge-caddy-1; do
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "${container}")" == "healthy" ]]
done
"${compose[@]}" config --quiet

mkdir -p -m 700 "${release_root}"
audit="${release_root}/activation.log"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "${audit}"; }
snapshot_protected() {
  local name names
  names="$(docker ps -a --format '{{.Names}}' | LC_ALL=C sort)" || return 1
  [[ -n "${names}" ]] || return 1
  while IFS= read -r name; do
    [[ "${name}" == "${api}" || "${name}" == "${worker}" ]] && continue
    docker inspect --format '{{.Name}} {{.Id}} {{.Image}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}' "${name}" || return 1
  done <<< "${names}"
}
snapshot_protected > "${release_root}/protected.before"
sha256sum "${project_root}/compose.yaml" "${project_root}/compose.muse.yaml" "${project_root}/.env" \
  /home/ans/docker/caddy/conf/Caddyfile \
  /home/ans/docker/caddy/custom-domains/academic-api.anssoft.com.tr.caddy > "${release_root}/configuration.before.sha256"
printf '%s\n' "${expected_old_id}" > "${release_root}/previous-image-id"
printf '%s\n' "${new_id}" > "${release_root}/new-image-id"
printf 'services:\n  api:\n    image: %s\n  content-worker:\n    image: %s\n' "${new_image}" "${new_image}" > "${release_root}/compose.yaml"
printf 'services:\n  api:\n    image: %s\n  content-worker:\n    image: %s\n' "${old_image}" "${old_image}" > "${release_root}/compose.rollback.yaml"
"${compose[@]}" -f "${release_root}/compose.yaml" config --quiet
assert_protected() {
  snapshot_protected > "${release_root}/protected.after" \
    && cmp -s "${release_root}/protected.before" "${release_root}/protected.after" \
    && sha256sum --check --status "${release_root}/configuration.before.sha256"
}
wait_ready() {
  local image_id="$1" deadline=$((SECONDS + 90)) worker_logs
  while (( SECONDS < deadline )); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "${api}" 2>/dev/null || true)" == "healthy" ]] \
      && [[ "$(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "${worker}" 2>/dev/null || true)" == "true 0" ]]; then
      worker_logs="$(docker logs --tail 1000 "${worker}" 2>&1)"
      if [[ "${worker_logs}" == *CONTENT_INGESTION_WORKER_READY* ]] \
        && ! grep -Eiq 'uncaught|unhandled|fatal|ENVIRONMENT_INVALID' <<< "${worker_logs}" \
        && docker exec "${api}" node -e "fetch('http://127.0.0.1:3000/health/ready',{signal:AbortSignal.timeout(5000)}).then(async r=>process.exit(r.ok&&(await r.json()).status==='ok'?0:1)).catch(()=>process.exit(1))"; then
        [[ "$(docker inspect --format '{{.Image}}' "${api}")" == "${image_id}" ]] || return 1
        [[ "$(docker inspect --format '{{.Image}}' "${worker}")" == "${image_id}" ]] || return 1
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}
activation_started=false
rollback() {
  local exit_code="${1:-$?}"
  trap - ERR INT TERM
  set +e
  log "Activation failed; restoring only API and content-worker."
  if [[ "${activation_started}" == "true" ]]; then
    if [[ "$(docker image inspect --format '{{.Id}}' "${old_image}")" != "${expected_old_id}" ]]; then
      log "ROLLBACK BLOCKED: previous image tag no longer matches its recorded immutable ID."
    elif timeout 120 "${compose[@]}" -f "${release_root}/compose.rollback.yaml" up -d --pull never --no-deps --no-build --force-recreate api content-worker >> "${audit}" 2>&1 \
      && wait_ready "${expected_old_id}" && assert_protected; then
      log "Rollback verified; original image and unrelated resources preserved."
    else
      log "ROLLBACK FAILED: manual verification required; see private activation log."
    fi
  fi
  exit "${exit_code}"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM

log "Activating revision ${release_id}; previous image ${expected_old_id}; candidate ${new_id}."
[[ "$(docker image inspect --format '{{.Id}}' "${new_image}")" == "${new_id}" ]]
activation_started=true
timeout 120 "${compose[@]}" -f "${release_root}/compose.yaml" up -d --pull never --no-deps --no-build --force-recreate api content-worker >> "${audit}" 2>&1
wait_ready "${new_id}"
assert_protected
for container in "${api}" "${worker}"; do
  [[ "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${container}")" == "${release_id}" ]]
done
log "Activation verified. Future Compose commands MUST include -f ${release_root}/compose.yaml."
trap - ERR INT TERM
