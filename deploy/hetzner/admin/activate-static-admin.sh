#!/usr/bin/env bash
# Replace only the admin bundle; retain API, database, compose and edge settings.
set -Eeuo pipefail
release_id="${1:?Usage: activate-static-admin.sh <commit>-<YYYYMMDD>}"
[[ "$release_id" =~ ^[a-f0-9]{7,40}-[0-9]{8}$ ]]
live=/opt/anssoft-admin/live
release="/opt/anssoft-admin/releases/$release_id"
incoming="$release/dist"
backup="/opt/anssoft-admin/backups/admin-$release_id-$(date +%Y%m%dT%H%M%S)"
caddy_before=$(docker inspect --format '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' anssoft-tenant-edge-caddy-1)
swapped=false
rollback() {
  result=$?
  trap - ERR
  if [[ "$swapped" == true ]]; then
    if [[ -d "$live/dist" ]]; then mv "$live/dist" "$backup/failed-dist"; fi
    mv "$backup/previous-dist" "$live/dist"
    docker compose --project-directory "$live" -f "$live/compose.yaml" up -d --no-deps --force-recreate admin
  fi
  echo "Activation failed; previous admin restored. Backup: $backup" >&2
  exit "$result"
}
trap rollback ERR
test -d "$live/dist"
test ! -L "$live/dist"
test -f "$incoming/index.html"
if find "$incoming" -type l -print -quit | grep -q .; then exit 1; fi
asset=$(grep -oE '/admin/assets/[^" ]+\.js' "$incoming/index.html" | sed -n '1p')
[[ "$asset" =~ ^/admin/assets/[A-Za-z0-9._-]+\.js$ ]]
test -f "$incoming/${asset#/admin/}"
grep -Fq 'https://academic-api.anssoft.com.tr' "$incoming/${asset#/admin/}"
if grep -Fq '.run.app' "$incoming/${asset#/admin/}"; then exit 1; fi
docker compose --project-directory "$live" -f "$live/compose.yaml" config --quiet
mkdir -p "$backup"
cp -a "$live/compose.yaml" "$live/Caddyfile" "$backup/"
# Retain old hashed assets for already-open browser sessions.
cp -an "$live/dist/assets/." "$incoming/assets/"
mv "$live/dist" "$backup/previous-dist"
swapped=true
mv "$incoming" "$live/dist"
docker compose --project-directory "$live" -f "$live/compose.yaml" up -d --no-deps --force-recreate admin
for attempt in $(seq 1 30); do
  state=$(docker inspect --format '{{.State.Health.Status}}' anssoft-academic-admin)
  [[ "$state" == healthy ]] && break
  sleep 2
done
[[ "$state" == healthy ]]
[[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' anssoft-academic-admin)" == '{}' ]]
curl -fsS https://academic-api.anssoft.com.tr/admin/ | grep -Fq "$asset"
curl -fsS https://academic-api.anssoft.com.tr/health/ready | grep -Fq '"status":"ok"'
[[ "$(docker inspect --format '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' anssoft-tenant-edge-caddy-1)" == "$caddy_before" ]]
printf 'release=%s\nasset=%s\nbackup=%s\n' "$release_id" "$asset" "$backup" > "$release/deployed.txt"
trap - ERR
printf 'deployment=passed\nasset=%s\nbackup=%s\n' "$asset" "$backup"
