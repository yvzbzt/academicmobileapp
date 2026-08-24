#!/usr/bin/env bash
set -Eeuo pipefail

requested_commit="${1:-HEAD}"
output_parent="${2:-.release-evidence/vps}"

release_id="$(git rev-parse --verify "${requested_commit}^{commit}")"
if [[ ! "${release_id}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve an immutable release commit." >&2
  exit 64
fi

output_root="${output_parent}/${release_id}"
if [[ -e "${output_root}" ]]; then
  echo "Release output already exists; refusing to overwrite: ${output_root}" >&2
  exit 65
fi

mkdir -p "${output_root}"
git archive \
  --format=tar.gz \
  --prefix=source/ \
  --output="${output_root}/source.tar.gz" \
  "${release_id}"
printf '%s\n' "${release_id}" > "${output_root}/release.commit"
(
  cd "${output_root}"
  archive_hash="$(sha256sum source.tar.gz | awk '{print $1}')"
  [[ "${archive_hash}" =~ ^[a-f0-9]{64}$ ]]
  printf '%s  source.tar.gz\n' "${archive_hash}" > source.archive.sha256
  sha256sum --check --strict source.archive.sha256
)

echo "VPS_RELEASE_PACKAGE_OK"
echo "RELEASE=${release_id}"
echo "PATH=${output_root}"
