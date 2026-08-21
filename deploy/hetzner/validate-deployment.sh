#!/usr/bin/env bash
set -euo pipefail

deployment_root="/opt/anssoft-academicmobilapp-backend"
source "${deployment_root}/api-network-probe.sh"

fail() {
  echo "VALIDATION FAILED: $*" >&2
  exit 1
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [[ "${actual}" == "${expected}" ]] || fail "${label}: expected ${expected}, got ${actual}"
}

assert_equal "$(readlink -f "${deployment_root}")" "${deployment_root}" "deployment root"
assert_equal "$(stat -c '%a' "${deployment_root}")" "700" "deployment directory mode"
assert_equal "$(stat -c '%a' "${deployment_root}/.env")" "600" "environment file mode"

assert_equal "$(docker inspect --format '{{.State.Status}}' anssoft-mongodb)" "running" "MongoDB state"
assert_equal "$(docker inspect --format '{{.State.Health.Status}}' anssoft-mongodb)" "healthy" "MongoDB health"
assert_equal "$(docker inspect --format '{{.State.Status}}' anssoft-backend)" "running" "API state"
assert_equal "$(docker inspect --format '{{.State.Health.Status}}' anssoft-backend)" "healthy" "API health"

assert_equal "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' anssoft-mongodb)" "unless-stopped" "MongoDB restart policy"
assert_equal "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' anssoft-backend)" "unless-stopped" "API restart policy"
assert_equal "$(docker inspect --format '{{.Config.User}}' anssoft-backend)" "node" "API runtime user"
assert_equal "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' anssoft-backend)" "true" "API read-only root filesystem"
assert_equal "$(docker inspect --format '{{.HostConfig.PidsLimit}}' anssoft-backend)" "256" "API PID limit"
assert_equal "$(docker inspect --format '{{.HostConfig.Memory}}' anssoft-backend)" "1073741824" "API memory limit"
assert_equal "$(docker inspect --format '{{.HostConfig.PidsLimit}}' anssoft-mongodb)" "256" "MongoDB PID limit"
assert_equal "$(docker inspect --format '{{.HostConfig.Memory}}' anssoft-mongodb)" "2147483648" "MongoDB memory limit"
assert_equal "$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' anssoft-backend)" "json-file" "API log driver"
assert_equal "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' anssoft-backend)" "10m" "API log size limit"
assert_equal "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' anssoft-backend)" "5" "API retained log files"
assert_equal "$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' anssoft-mongodb)" "json-file" "MongoDB log driver"
assert_equal "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' anssoft-mongodb)" "10m" "MongoDB log size limit"
assert_equal "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' anssoft-mongodb)" "5" "MongoDB retained log files"

docker inspect --format '{{json .HostConfig.CapDrop}}' anssoft-backend | grep -q '"ALL"' || fail "API does not drop all Linux capabilities"
docker inspect --format '{{json .HostConfig.SecurityOpt}}' anssoft-backend | grep -q 'no-new-privileges:true' || fail "API no-new-privileges is disabled"

assert_equal "$(docker network inspect --format '{{.Internal}}' anssoft-internal)" "true" "private network isolation"
assert_equal "$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' anssoft-internal)" "172.30.77.0/24" "private network subnet"
assert_equal "$(docker network inspect --format '{{.Internal}}' anssoft-egress)" "false" "API egress network"
assert_equal "$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' anssoft-egress)" "172.30.78.0/24" "API egress subnet"
assert_equal "$(docker network inspect --format '{{.Internal}}' anssoft-academic-edge)" "true" "Caddy/API proxy network isolation"
assert_equal "$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' anssoft-academic-edge)" "172.30.79.0/24" "Caddy/API proxy subnet"
docker volume inspect anssoft-mongodb-data anssoft-mongodb-config >/dev/null
docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' anssoft-mongodb |
  grep -Fq 'anssoft-mongodb-data /data/db' || fail "named MongoDB data volume is not mounted"
docker inspect --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}' anssoft-mongodb |
  grep -Fq 'anssoft-mongodb-config /data/configdb' || fail "named MongoDB config volume is not mounted"

mongo_ports="$(docker port anssoft-mongodb 2>/dev/null || true)"
[[ -z "${mongo_ports}" ]] || fail "MongoDB unexpectedly publishes a host port"
if ss -lntH | awk '{print $4}' | grep -Eq '(^|:)27017$'; then
  fail "host is listening on MongoDB port 27017"
fi
api_ports="$(docker port anssoft-backend 2>/dev/null || true)"
[[ -z "${api_ports}" ]] || fail "API unexpectedly publishes a host port"
if ss -lntH | awk '{print $4}' | grep -Eq '(^|:)18080$'; then
  fail "obsolete API host port 18080 is still listening"
fi

proxy_members="$(docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' anssoft-academic-edge |
  sed '/^[[:space:]]*$/d' |
  sort)"
expected_proxy_members=$'anssoft-backend\nanssoft-tenant-edge-caddy-1'
assert_equal "${proxy_members}" "${expected_proxy_members}" "Caddy/API proxy network members"
docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' anssoft-academic-edge |
  grep -Fxq 'anssoft-mongodb' && fail "MongoDB is attached to the Caddy/API proxy network"

docker exec anssoft-mongodb mongod --version | sed -n '1p'

if docker exec anssoft-mongodb mongosh --quiet --host 127.0.0.1 \
  --eval 'const result=db.getSiblingDB("academic_calendar").runCommand({listCollections:1}); if (result.ok === 1) quit(0); quit(7)' \
  >/dev/null 2>&1; then
  fail "unauthenticated MongoDB collection access succeeded"
fi
echo "Unauthenticated MongoDB collection access: denied"

docker exec anssoft-mongodb sh -ec '
  mongosh --quiet --host 127.0.0.1 \
    --username "$MONGO_APP_USERNAME" \
    --password "$MONGO_APP_PASSWORD" \
    --authenticationDatabase "$MONGO_APP_DATABASE" \
    "$MONGO_APP_DATABASE" \
    --eval "
      const status = db.runCommand({connectionStatus: 1});
      const roles = status.authInfo.authenticatedUserRoles;
      if (!roles.some((role) => role.role === \"readWrite\" && role.db === \"$MONGO_APP_DATABASE\")) quit(2);
      const collection = db.getCollection(\"__deployment_validation\");
      const marker = \"anssoft-\" + Date.now();
      collection.insertOne({_id: marker, createdAt: new Date()});
      if (!collection.findOne({_id: marker})) quit(3);
      collection.deleteOne({_id: marker});
      if (collection.countDocuments({_id: marker}) !== 0) quit(4);
      collection.drop();
      print(\"Authenticated MongoDB CRUD and app-user role: ok\");
    "
'

docker exec anssoft-mongodb sh -ec '
  mongosh --quiet --host 127.0.0.1 \
    --username "$MONGO_APP_USERNAME" \
    --password "$MONGO_APP_PASSWORD" \
    --authenticationDatabase "$MONGO_APP_DATABASE" \
    "$MONGO_APP_DATABASE" \
    --eval "
      const counts = {
        universities: db.universities.countDocuments({}),
        faculties: db.faculties.countDocuments({}),
        departments: db.departments.countDocuments({}),
        announcementSources: db.announcement_sources.countDocuments({})
      };
      if (counts.universities < 205 || counts.faculties < 2924 || counts.departments < 14424) quit(5);
      if (counts.announcementSources < 1) quit(6);
      if (!db.universities.findOne({_id: \"abdullah-gul-universitesi-kayseri\"})) quit(7);
      print(\"Seeded MongoDB records: \" + JSON.stringify(counts));
    "
'

api_get "/health/ready" |
  python3 -c '
import json
import sys

body = json.load(sys.stdin)
assert body["status"] == "ok"
mongodb = next(item for item in body["dependencies"] if item["name"] == "mongodb")
assert mongodb["status"] == "ok"
print("API readiness and MongoDB dependency: ok")
'

api_get "/universities?limit=2&offset=0" |
  python3 -c '
import json
import sys

rows = json.load(sys.stdin)
assert len(rows) == 2
assert all(isinstance(row.get("id"), str) and row["id"] for row in rows)
print("Catalog endpoint, pagination, and stable IDs: ok")
'

cors_origin="$(docker exec anssoft-backend node -e "
  fetch('http://127.0.0.1:3000/universities', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://academic-mobile-app-7629.web.app',
      'Access-Control-Request-Method': 'GET'
    }
  }).then((response) => {
    console.log(response.headers.get('access-control-allow-origin') ?? '');
  }).catch((error) => {
    console.error(error.message);
    process.exit(3);
  });
")"
[[ "${cors_origin}" == "https://academic-mobile-app-7629.web.app" ]] ||
  fail "Firebase Hosting origin is not allowed by CORS"
echo "Firebase Hosting CORS origin: allowed"

docker exec anssoft-backend node -e "
  fetch('https://oauth2.googleapis.com/tokeninfo?id_token=anssoft-connectivity-check')
    .then((response) => {
      if (![400, 401].includes(response.status)) process.exit(2);
      console.log('Google OAuth endpoint egress: reachable (' + response.status + ')');
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(3);
    });
"

api_get "/health/live" |
  python3 -c '
import json
import sys

assert json.load(sys.stdin)["status"] == "ok"
print("Existing Caddy container can reach proposed upstream: ok")
'

set -a
source "${deployment_root}/.env"
set +a
combined_logs="$(docker logs anssoft-backend 2>&1; docker logs anssoft-mongodb 2>&1)"
for variable_name in \
  MONGO_ROOT_PASSWORD \
  MONGO_APP_PASSWORD \
  JWT_ACCESS_SECRET \
  JWT_REFRESH_SECRET \
  EMAIL_VERIFICATION_TOKEN_PEPPER \
  PASSWORD_RECOVERY_TOKEN_PEPPER \
  DATA_ENCRYPTION_KEY \
  DATA_LOOKUP_HMAC_SECRET \
  CALENDAR_FEED_SECRET; do
  value="${!variable_name:-}"
  [[ -z "${value}" ]] && continue
  if grep -Fq -- "${value}" <<<"${combined_logs}"; then
    fail "a protected value from ${variable_name} appears in container logs"
  fi
done
unset MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET
unset EMAIL_VERIFICATION_TOKEN_PEPPER PASSWORD_RECOVERY_TOKEN_PEPPER
unset DATA_ENCRYPTION_KEY DATA_LOOKUP_HMAC_SECRET CALENDAR_FEED_SECRET

api_logs="$(docker logs anssoft-backend 2>&1)"
if grep -Eiq 'uncaught|unhandled rejection|fatal|EADDRINUSE|MONGODB_[A-Z_]*FAILED' <<<"${api_logs}"; then
  fail "API logs contain a critical runtime error"
fi
echo "Container logs: no generated secrets or critical API errors"

echo "Deployment validation: passed"
