#!/usr/bin/env bash
# Downloads the BodyM dataset (Amazon, CC BY-NC 4.0) into data/bodym/.
#
#   https://registry.opendata.aws/bodym/
#
# BodyM pairs front and side silhouettes of real people with their height
# and 14 measurements taken from 3D body scans. It is what lets this project
# report a measured error instead of trusting one tape-measured subject.
#
# Non-commercial licence: fine for development and research. Anything tuned
# on it must be re-derived from consented data before a commercial release.
#
# Safe to re-run: files already present are skipped, so a dropped connection
# costs only the files that failed. A transfer that fails is retried in
# later passes, and anything still missing is listed at the end rather than
# silently ignored.
#
# Usage: tools/fetch-bodym.sh [split ...]   (default: train testA testB)
#        JOBS=4 tools/fetch-bodym.sh        (parallel downloads; default 8)
set -uo pipefail

BASE="https://amazon-bodym.s3.us-west-2.amazonaws.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)/data/bodym"
JOBS="${JOBS:-8}"
PASSES=4
SPLITS=("$@")
[ ${#SPLITS[@]} -eq 0 ] && SPLITS=(train testA testB)

# Prints the masks of one split that are absent or empty, one relative path
# per line. (-s is "exists and is non-empty"; a cut-off transfer can leave
# a zero-byte file that must count as missing.)
missing() {
  local dir="$1"
  tail -n +2 "$dir/subject_to_photo_map.csv" | cut -d, -f2 | tr -d '\r' |
    while read -r id; do
      for view in mask mask_left; do
        [ -s "$dir/$view/$id.png" ] || echo "$view/$id.png"
      done
    done
}

status=0
for split in "${SPLITS[@]}"; do
  dir="$ROOT/$split"
  mkdir -p "$dir/mask" "$dir/mask_left"

  for f in hwg_metadata.csv measurements.csv subject_to_photo_map.csv; do
    if [ ! -s "$dir/$f" ]; then
      curl -sSf --retry 3 -o "$dir/$f" "$BASE/$split/$f" || {
        echo "$split: could not fetch $f" >&2
        status=1
      }
    fi
  done
  [ -s "$dir/subject_to_photo_map.csv" ] || continue

  for pass in $(seq "$PASSES"); do
    todo="$(missing "$dir")"
    [ -z "$todo" ] && break
    echo "$split: pass $pass, $(echo "$todo" | wc -l) files to fetch" >&2
    # A failed curl must not stop the others, so xargs' exit status is
    # ignored here; the next pass re-checks what is actually on disk.
    echo "$todo" |
      xargs -P "$JOBS" -I{} curl -sSf --retry 2 -o "$dir/{}" "$BASE/$split/{}" 2>/dev/null || true
  done

  left="$(missing "$dir")"
  want=$(( $(wc -l < "$dir/subject_to_photo_map.csv") - 1 ))
  if [ -n "$left" ]; then
    echo "$split: STILL MISSING $(echo "$left" | wc -l) of $((want * 2)) masks:" >&2
    echo "$left" | head -20 >&2
    status=1
  else
    echo "$split: complete, $want front + $want side masks"
  fi
done
exit $status
