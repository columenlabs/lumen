#!/usr/bin/env bash
# Switching off React's "missing dependency" lint says why, in at least three words: a silenced
# dependency is how an effect loops or reads stale state, so each one carries its reason for the
# next reader.
# Run from a package folder by its lint script.
set -euo pipefail
bad=$(grep -rnE "biome-ignore lint/correctness/useExhaustiveDependencies" src \
  | awk -F'useExhaustiveDependencies:?' '{ n = split($2, w, " "); if (n < 3) { split($0, a, ":"); print a[1] ":" a[2] } }' || true)
if [ -n "$bad" ]; then
  echo "A useExhaustiveDependencies suppression needs its reason (three words or more):" >&2
  echo "$bad" >&2
  exit 1
fi
