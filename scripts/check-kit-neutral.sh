#!/usr/bin/env bash
# The kit names no product: no app's names in code or copy, and no import of an app's own
# packages. An app passes its names through `configureLumen` and its data through
# `registerDomains`. The names to refuse are kept outside the repo, in the environment variable
# LUMEN_FORBIDDEN_NAMES (a regex alternation, `A|B|C`); CI reads it from the repository variable
# of the same name, and the check is skipped where it is not set. Comments count too.
# Run from a kit package folder by its lint script; the docs pass their own folders.
set -euo pipefail
names=${LUMEN_FORBIDDEN_NAMES:-}
[ -n "$names" ] || exit 0
targets=("$@")
[ ${#targets[@]} -gt 0 ] || targets=(src package.json README.md)
bad=$(grep -rnE "\b($names)\b" "${targets[@]}" || true)
if [ -n "$bad" ]; then
  echo "The kit names no product: pass names through configureLumen, data through registerDomains:" >&2
  echo "$bad" >&2
  exit 1
fi
