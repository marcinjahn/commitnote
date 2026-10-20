#!/usr/bin/env bash
set -euo pipefail

tag_pattern='^v0\.1\.[0-9]+$'
keep_default=10

usage() {
  echo "usage: $0 previous <number> < tags" >&2
  echo "       $0 prune [keep] < tags" >&2
  echo "       $0 latest <number> < tags" >&2
  echo "       $0 notes <tag> <sha> <repo> <sums-file> < tags" >&2
  exit 2
}

desktop_tags_desc() {
  grep -E "$tag_pattern" | sort -t. -k3,3nr || true
}

previous_tag() {
  local number=$1 tag
  desktop_tags_desc | while read -r tag; do
    if [ "${tag##*.}" -lt "$number" ]; then
      echo "$tag"
      break
    fi
  done
}

is_latest() {
  local number=$1 highest
  highest=$(desktop_tags_desc | sed -n '1p')
  if [ -n "$highest" ] && [ "${highest##*.}" -gt "$number" ]; then
    echo false
  else
    echo true
  fi
}

cmd=${1:-}
[ -n "$cmd" ] || usage
shift

case "$cmd" in
previous)
  [ "$#" -eq 1 ] || usage
  previous_tag "$1"
  ;;
latest)
  [ "$#" -eq 1 ] || usage
  is_latest "$1"
  ;;
prune)
  keep=${1:-$keep_default}
  desktop_tags_desc | tail -n +"$((keep + 1))"
  ;;
notes)
  [ "$#" -eq 4 ] || usage
  tag=$1
  sha=$2
  repo=$3
  sums_file=$4
  previous=$(previous_tag "${tag##*.}")
  echo "Built from commit [\`${sha:0:7}\`](https://github.com/$repo/commit/$sha)."
  echo
  if [ -n "$previous" ]; then
    echo "Changes since $previous: https://github.com/$repo/compare/$previous...$tag"
    echo
  fi
  echo "SHA-256:"
  echo
  echo '```'
  cat "$sums_file"
  echo '```'
  echo
  echo "Verify the download:"
  echo
  echo '```'
  echo "sha256sum -c SHA256SUMS"
  echo "gh attestation verify commitnote-x86_64.AppImage --repo $repo"
  echo '```'
  ;;
*) usage ;;
esac
