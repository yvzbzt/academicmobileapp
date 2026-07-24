#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "PRESERVATION CHECK FAILED: $*" >&2
  exit 1
}

check_container() {
  local name="$1"
  local expected_id="$2"
  local expected_started_at="$3"
  local actual_id
  local actual_started_at

  actual_id="$(docker inspect --format '{{.Id}}' "${name}")"
  actual_started_at="$(docker inspect --format '{{.State.StartedAt}}' "${name}")"
  [[ "${actual_id}" == "${expected_id}" ]] || fail "${name} container ID changed"
  [[ "${actual_started_at}" == "${expected_started_at}" ]] || fail "${name} start time changed"
  [[ "$(docker inspect --format '{{.RestartCount}}' "${name}")" == "0" ]] || fail "${name} restart count changed"
  [[ "$(docker inspect --format '{{.State.Running}}' "${name}")" == "true" ]] || fail "${name} is not running"
  echo "Preserved container: ${name}"
}

check_network() {
  local name="$1"
  local expected_id="$2"
  [[ "$(docker network inspect --format '{{.Id}}' "${name}")" == "${expected_id}" ]] || fail "${name} network ID changed"
  echo "Preserved network: ${name}"
}

check_hash() {
  local path="$1"
  local expected="$2"
  [[ "$(sha256sum "${path}" | awk '{print $1}')" == "${expected}" ]] || fail "${path} changed"
  echo "Preserved file: ${path}"
}

check_container \
  tenant-hjkhk-1ec61279-tenant-api-1 \
  14ae9857ca75362241bb29d5eab873391934126b9e0d057acc6a67963a385dd4 \
  2026-06-22T06:35:28.493017162Z
check_container \
  tenant-hjkhk-1ec61279-tenant-db-1 \
  1f61ad61d4fbfa397c839e0d3ac686567d911ef6e8219df27730ff3978a03c13 \
  2026-06-22T06:35:17.697010691Z
check_container \
  tenant-stack-postgres-1 \
  58c30f68abc10a91e82c13cb63247fad7390b211723c77f4302965a7a82f357e \
  2026-06-11T22:29:03.590554383Z
check_container \
  mer-faruk-zcan-website-b2b-tenant-db-1 \
  60a208b2ca43e623d2b4114281599576fa0aa9b5cb9fa9c71713738499cfa17c \
  2026-06-16T17:12:59.248645121Z
check_container \
  anssoft-tenant-manager-tenant-manager-1 \
  76d3ed87a82127fcc5acdb60fa266b8167f9b9a20bb44c40b65767e7841e9229 \
  2026-06-17T06:21:12.732817469Z
check_container \
  mer-faruk-zcan-website-b2b-tenant-api-1 \
  bd231594aa321fea1ea41692aa5301e93cef8fe880fdd8c5d05a40592b3e0252 \
  2026-06-16T17:13:10.04104249Z
check_container \
  anssoft-tenant-edge-caddy-1 \
  d37e90152ad7dcf3b7f0942d301ac1c5d3cf33da020a71bcc440218c2b5b3eea \
  2026-06-17T11:31:54.187759883Z

check_network anssoft-tenant-internal 334bf00adb48bc95cec10389520062b133f1006e4f85129963d927adb990752d
check_network edge 33fd01d7e87bc582abd38276a102529d743218635f2c24444395026dd949b71d
check_network host 376077a4ca85d3e1fb067a1b556296b23eafca97ccb9f3aa4d57e1543c9c5fe9
check_network tenant-stack_default 554396efb9fd38d167a5ee01ca4a1bd9a09940cbb78bffd5074affb10f0787cf
check_network tenant-mer-faruk-zcan-website-b2b 5db2303cdde1a3242c6c48c6840409a334f05cbe6e328b228e7f7da204416cfd
check_network bridge 9f64f91ef48e6437939ef59eb3dfff75cef9a46e3c829f6e2aa545a995374c5b
check_network none d6c69b9d17a5bd2ce10e91a69b2db08988d4eade13a98dd08d1c1ed0f6630195

for volume in anssoft-tenant-edge_caddy_config anssoft-tenant-edge_caddy_data tenant-stack_pgdata; do
  docker volume inspect "${volume}" >/dev/null
  echo "Preserved volume: ${volume}"
done

check_hash /home/ans/docker/caddy/compose.yml e65f04a601ce54e011f31f660f9dde62f717091a6136a4ead07bdae84bf76612
check_hash /home/ans/docker/caddy/conf/Caddyfile 4660c36710083e1c6529e95c5122f82284cf7f05e1e040356d4078629e85472d
check_hash /home/ans/docker/caddy/.env 8d546c87707962e226db7abbe995c889beb11bf4ac9419c794fdcddbe843a27f
check_hash /home/ans/docker/caddy/tenant-routes/1ec612793bf917ab-hjkhk.caddy 6ae6f95fcd341d43815bb9723b6deabb078a8254121713c0b7e882e3865bfb85
check_hash /home/ans/docker/caddy/tenant-routes/b84e6f9c2d0a451e-mer-faruk-zcan-website-b2b.caddy 39f2fc3738258bc6e38aef99f6c763fc44e7950fc6f95513ad9a809da1bd81ce

check_hash \
  /home/ans/docker/caddy/custom-domains/academic-api.anssoft.com.tr.caddy \
  a2b2be9ab165be1d61512ceb57fba5219ab1ca929cbc895b789be1101d15925b

[[ "$(docker ps --format '{{.Names}}' | wc -l)" == "9" ]] || fail "unexpected running-container count"

[[ "$(docker network inspect --format '{{.Internal}}' anssoft-academic-edge)" == "true" ]] ||
  fail "academic proxy network is not internal"
[[ "$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' anssoft-academic-edge)" == "172.30.79.0/24" ]] ||
  fail "academic proxy network subnet changed"
academic_edge_members="$(docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' anssoft-academic-edge |
  sed '/^[[:space:]]*$/d' |
  sort)"
[[ "${academic_edge_members}" == $'anssoft-backend\nanssoft-tenant-edge-caddy-1' ]] ||
  fail "academic proxy network membership changed"

for address in 0.0.0.0:22 0.0.0.0:80 0.0.0.0:443 0.0.0.0:30530 127.0.0.1:5432; do
  ss -lntH | awk '{print $4}' | grep -Fxq "${address}" || fail "protected listener missing: ${address}"
done

echo "Existing-resource preservation: passed"
