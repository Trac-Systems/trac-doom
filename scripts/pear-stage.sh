#!/usr/bin/env bash
set -euo pipefail

channel="${1:-}"
dir="${2:-.}"

if [[ -z "$channel" ]]; then
  echo "Usage: $0 <channel|link> [dir]" >&2
  exit 1
fi

ignore_list=()
shopt -s nullglob
for p in "$dir"/store_*; do
  if [[ -d "$p" ]]; then
    ignore_list+=("$(basename "$p")")
  fi
done
shopt -u nullglob

ignore_arg=""
if (( ${#ignore_list[@]} > 0 )); then
  ignore_arg="--ignore $(IFS=,; echo "${ignore_list[*]}")"
fi

set -x
pear stage ${ignore_arg} --purge "$channel" "$dir"
