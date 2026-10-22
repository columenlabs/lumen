#!/usr/bin/env bash
# A Settings section's description is one line, never wrapped: a plain string
# of at most 64 characters, which fits the section header on desktop (the header truncates it on a
# phone). Run from a desk or the shell folder by its lint script.
set -euo pipefail
MAX=64
bad=$({ grep -rlE "SettingsSectionDef" src --include='*.tsx' || true; } | xargs -r perl -0777 -ne '
  while (/icon:\s*\w+,\s*(?:sub:\s*true,\s*)?description:\s*(\x27([^\x27]*)\x27|"([^"]*)"|[^\x27"\s][^,\n]*)/g) {
    my $text = defined $2 ? $2 : $3;
    if (!defined $text) { print "$ARGV: description is not a plain string: $1\n"; next; }
    print "$ARGV: ", length($text), " characters (max '"$MAX"'): $text\n" if length($text) > '"$MAX"';
  }')
if [ -n "$bad" ]; then
  echo "Settings descriptions must fit on one line:" >&2
  echo "$bad" >&2
  exit 1
fi
