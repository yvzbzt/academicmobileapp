#!/usr/bin/env bash

api_get() {
  local path="${1:?API path is required}"
  docker exec anssoft-tenant-edge-caddy-1 \
    wget -qO- "http://academic-api:3000${path}"
}
