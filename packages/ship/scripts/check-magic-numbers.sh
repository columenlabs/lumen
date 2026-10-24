#!/usr/bin/env bash
# No new hard-coded lengths: a pixel or rem value written into a class
# (`left-[17px]`, `text-[11px]`) is a band-aid sized for one screen, and the next layout change
# breaks it. Use a token, a CSS variable or a Tailwind scale step instead.
# The count may only fall: the repo's scripts/magic-numbers.baseline (or LUMEN_SHIP_BASELINE) holds
# each package's count today, one `<folder> <count>` a line; lower it in the change that removes one.
# Run from a package folder by its lint script.
set -euo pipefail
baseline=${LUMEN_SHIP_BASELINE:-$(git rev-parse --show-toplevel)/scripts/magic-numbers.baseline}
pkg=$(basename "$PWD")
# `|| true`: a package with none (grep finds nothing) passes.
n=$({ grep -rEoh --include=*.tsx --include=*.ts -- '-?\b[a-z-]+-\[-?[0-9.]+(px|rem)\]' src || true; } | wc -l | tr -d ' ')
base=$( [ -f "$baseline" ] && awk -v p="$pkg" '$1 == p { print $2 }' "$baseline" || true)
base=${base:-0}
if [ "$n" -gt "$base" ]; then
  echo "$pkg: $n hard-coded px/rem class values, baseline $base. Use a token or CSS variable:" >&2
  grep -rnE --include=*.tsx --include=*.ts -- '-?\b[a-z-]+-\[-?[0-9.]+(px|rem)\]' src >&2
  exit 1
fi
