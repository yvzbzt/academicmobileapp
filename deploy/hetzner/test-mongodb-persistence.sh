#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/api-network-probe.sh"
mongo_id_before="$(docker inspect --format '{{.Id}}' anssoft-mongodb)"
api_id_before="$(docker inspect --format '{{.Id}}' anssoft-backend)"
restart_count_before="$(docker inspect --format '{{.RestartCount}}' anssoft-mongodb)"

docker exec anssoft-mongodb sh -ec '
  mongosh --quiet --host 127.0.0.1 \
    --username "$MONGO_APP_USERNAME" \
    --password "$MONGO_APP_PASSWORD" \
    --authenticationDatabase "$MONGO_APP_DATABASE" \
    "$MONGO_APP_DATABASE" \
    --eval "
      const collection = db.getCollection(\"__deployment_persistence\");
      collection.deleteMany({});
      collection.insertOne({_id: \"restart-proof\", createdAt: new Date()});
      if (!collection.findOne({_id: \"restart-proof\"})) quit(2);
    "
'

mongo_host_pid="$(docker inspect --format '{{.State.Pid}}' anssoft-mongodb)"
if [[ -z "${mongo_host_pid}" || "${mongo_host_pid}" -le 1 ]]; then
  echo "Could not identify the MongoDB host PID." >&2
  exit 1
fi
kill -9 "${mongo_host_pid}"

deadline=$((SECONDS + 240))
while (( SECONDS < deadline )); do
  mongo_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' anssoft-mongodb)"
  api_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' anssoft-backend)"
  echo "Recovery health: MongoDB=${mongo_health}, API=${api_health}"
  if [[ "${mongo_health}" == "healthy" && "${api_health}" == "healthy" ]]; then
    break
  fi
  sleep 10
done

[[ "$(docker inspect --format '{{.Id}}' anssoft-mongodb)" == "${mongo_id_before}" ]]
[[ "$(docker inspect --format '{{.Id}}' anssoft-backend)" == "${api_id_before}" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' anssoft-mongodb)" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' anssoft-backend)" == "healthy" ]]

restart_count_after="$(docker inspect --format '{{.RestartCount}}' anssoft-mongodb)"
if (( restart_count_after <= restart_count_before )); then
  echo "MongoDB restart count did not increase." >&2
  exit 1
fi

docker exec anssoft-mongodb sh -ec '
  mongosh --quiet --host 127.0.0.1 \
    --username "$MONGO_APP_USERNAME" \
    --password "$MONGO_APP_PASSWORD" \
    --authenticationDatabase "$MONGO_APP_DATABASE" \
    "$MONGO_APP_DATABASE" \
    --eval "
      const collection = db.getCollection(\"__deployment_persistence\");
      if (!collection.findOne({_id: \"restart-proof\"})) quit(3);
      collection.deleteOne({_id: \"restart-proof\"});
      collection.drop();
      print(\"MongoDB persisted the temporary record across process restart\");
    "
'

api_get "/health/ready" >/dev/null
echo "MongoDB persistence and automatic crash recovery: passed (${restart_count_before} -> ${restart_count_after})"
