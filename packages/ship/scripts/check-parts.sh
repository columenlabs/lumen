#!/usr/bin/env bash
# The kit's part pages (docs/parts in the Lumen repo) hold in an app: each rule below counts its
# breaks per folder, and a count may only fall. The repo's scripts/parts.baseline (or
# LUMEN_SHIP_PARTS_BASELINE) holds today's counts, one `<folder> <rule> <count>` a line; lower a
# count in the change that removes a break. `--write-baseline` writes the counts as they are now,
# for a first run. Run from the repo root with the app folders: lumen-ship check parts apps/*/web/src
#   hint-text    a grey line under a field or title: <p className="... text-xs ... text-muted-foreground ...">
#   text-action  a <Button> whose text is an action: an IconButton (or SaveButton) instead
#   raw-overlay  an import of the kit's raw ui/sheet, ui/dialog, ui/select, ui/command or ui/combobox
set -euo pipefail
write=0
if [ "${1:-}" = "--write-baseline" ]; then
  write=1
  shift
fi
if [ $# -eq 0 ]; then
  echo "usage: lumen-ship check parts [--write-baseline] <folder>..." >&2
  exit 1
fi
baseline=${LUMEN_SHIP_PARTS_BASELINE:-$(git rev-parse --show-toplevel)/scripts/parts.baseline}
rules="hint-text text-action raw-overlay"

# Prints `file:line` for each break of one rule in one folder.
hits() {
  local rule=$1 dir=$2
  find "$dir" -type f -name '*.tsx' -not -path '*/node_modules/*' -print0 \
    | xargs -0 -r perl -0777 -ne '
      my $rule = "'"$rule"'";
      my $re;
      if ($rule eq "hint-text") {
        $re = qr/<p\s[^>]*className="(?=[^"]*\btext-xs\b)(?=[^"]*\btext-muted-foreground\b)[^"]*"/;
      } elsif ($rule eq "text-action") {
        $re = qr/<Button\b[^>]*>\s*(?:<[A-Z]\w*[^>]*\/>\s*)?(?:\{[^}]*\?\s*)?\x27?(?:Save|Run|Test|Send|Sync|Refresh|Copy|Edit|Delete|Remove|Retry|Reset)\b/;
      } else {
        $re = qr/from\s+[\x27"]\@columenlabs\/lumen-ui\/ui\/(?:sheet|dialog|select|command|combobox)[\x27"]/;
      }
      while (/$re/g) {
        my $line = 1 + (substr($_, 0, $-[0]) =~ tr/\n//);
        print "$ARGV:$line\n";
      }'
}

failed=0
out=""
for dir in "$@"; do
  [ -d "$dir" ] || continue
  for rule in $rules; do
    list=$(hits "$rule" "$dir")
    n=$(printf '%s' "$list" | grep -c . || true)
    if [ "$write" = 1 ]; then
      out+="$dir $rule $n"$'\n'
      continue
    fi
    base=$( [ -f "$baseline" ] && awk -v d="$dir" -v r="$rule" '$1 == d && $2 == r { print $3 }' "$baseline" || true)
    base=${base:-0}
    if [ "$n" -gt "$base" ]; then
      failed=1
      echo "$dir: $n $rule, baseline $base (see docs/parts/README.md in the Lumen repo):" >&2
      printf '%s\n' "$list" >&2
    fi
  done
done
if [ "$write" = 1 ]; then
  printf '%s' "$out" | awk '$3 > 0' > "$baseline"
  echo "wrote $baseline" >&2
fi
exit "$failed"
