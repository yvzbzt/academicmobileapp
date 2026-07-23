#!/usr/bin/env bash
set -euo pipefail

section() {
  echo
  echo "===== $1 ====="
}

section "CAPTURED_AT"
date --iso-8601=seconds

section "HOST_CAPACITY"
uptime
free -h
df -h /

section "DEPLOYMENT_STATUS"
cd /opt/anssoft-academicmobilapp-backend
docker compose --env-file .env -f compose.yaml ps

section "NEW_CONTAINER_RUNTIME"
for container in anssoft-mongodb anssoft-backend; do
  docker inspect --format \
    '{{.Id}}|{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}|{{.Config.Image}}' \
    "${container}"
done

section "NEW_CONTAINER_LIMITS"
for container in anssoft-mongodb anssoft-backend; do
  docker inspect --format \
    '{{.Name}}|user={{.Config.User}}|readonly={{.HostConfig.ReadonlyRootfs}}|memory={{.HostConfig.Memory}}|nano_cpus={{.HostConfig.NanoCpus}}|pids={{.HostConfig.PidsLimit}}|cap_drop={{json .HostConfig.CapDrop}}|security={{json .HostConfig.SecurityOpt}}' \
    "${container}"
done

section "NEW_IMAGES"
docker image inspect --format '{{.Id}}|{{json .RepoTags}}|created={{.Created}}|user={{.Config.User}}' \
  anssoft-backend:2026-07-17
docker image inspect --format '{{.Id}}|{{json .RepoTags}}|created={{.Created}}' mongo:8.0

section "NETWORKS"
docker network inspect --format \
  '{{.Id}}|{{.Name}}|internal={{.Internal}}|subnet={{(index .IPAM.Config 0).Subnet}}|containers={{len .Containers}}' \
  anssoft-internal anssoft-egress anssoft-academic-edge
ip -4 route show | grep -E '172\.30\.77\.0/24|172\.30\.78\.0/24|172\.30\.79\.0/24|172\.19\.0\.0/16'

section "VOLUME"
docker volume inspect --format '{{.Name}}|driver={{.Driver}}|mountpoint={{.Mountpoint}}|created={{.CreatedAt}}' \
  anssoft-mongodb-data anssoft-mongodb-config

section "LISTENERS"
ss -lntup | grep -E '(:22 |:53 |:80 |:443 |:5432 |:27017 |:30530 )' || true

section "RESOURCE_USAGE"
docker stats --no-stream --format '{{.Name}}|cpu={{.CPUPerc}}|memory={{.MemUsage}}|pids={{.PIDs}}' \
  anssoft-mongodb anssoft-backend

section "DEPLOYMENT_FILES"
stat -c '%a|%U:%G|%n' \
  /opt/anssoft-academicmobilapp-backend \
  /opt/anssoft-academicmobilapp-backend/.env \
  /opt/anssoft-academicmobilapp-backend/compose.yaml \
  /opt/anssoft-academicmobilapp-backend/Caddyfile.proposed \
  /opt/anssoft-academicmobilapp-backend/deployment-files.sha256
cat /opt/anssoft-academicmobilapp-backend/deployment-files.sha256

section "CADDY_ROUTE_STATE"
if [[ -e /home/ans/docker/caddy/custom-domains/academic-api.anssoft.com.tr.caddy ]]; then
  echo "applied"
else
  echo "not applied"
fi

section "PRESERVATION"
/opt/anssoft-academicmobilapp-backend/verify-existing-resources.sh
