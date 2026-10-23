#!/usr/bin/env bash
# One-off (2026-10-23): renumber every version so far into 0.1.*, in order. Remove once run.
#   npm   the same published builds again as 0.1.0 to 0.1.12 (tag "legacy" while it works, then
#         latest = 0.1.12); 0.2.0 to 0.4.4 deprecated, each naming its new number. npm never reuses
#         a number, so the old ones stay. 0.1.0 and 0.1.1 were published under the old names
#         (@columenlabs/lumen, @columenlabs/lumen-types) and are renamed on the way.
#   git   tags v0.2.0 to v0.4.4 become v0.1.2 to v0.1.12 on the same commits; the GitHub
#         releases move with them and every tag gets its release, notes written again.
# Does nothing once v0.1.12 exists. Run by .github/workflows/publish.yml before it publishes.
# Needs NODE_AUTH_TOKEN (npm), GH_TOKEN, jq, and the env scripts/release.sh needs.
set -euo pipefail
REPO=columenlabs/lumen-ui
git fetch -q --tags origin
if git rev-parse -q --verify refs/tags/v0.1.12 > /dev/null; then echo "already renumbered"; exit; fi

# new old-npm-version old-ui-package old-types-package old-tag
MAP="0.1.0 0.1.0 lumen lumen-types v0.1.0
0.1.1 0.1.1 lumen lumen-types v0.1.1
0.1.2 0.2.0 lumen-ui lumen-ui-types v0.2.0
0.1.3 0.2.1 lumen-ui lumen-ui-types v0.2.1
0.1.4 0.2.2 lumen-ui lumen-ui-types v0.2.2
0.1.5 0.3.0 lumen-ui lumen-ui-types v0.3.0
0.1.6 0.3.1 lumen-ui lumen-ui-types v0.3.1
0.1.7 0.3.2 lumen-ui lumen-ui-types v0.3.2
0.1.8 0.4.0 lumen-ui lumen-ui-types v0.4.0
0.1.9 0.4.1 lumen-ui lumen-ui-types v0.4.1
0.1.10 0.4.2 lumen-ui lumen-ui-types v0.4.2
0.1.11 0.4.3 lumen-ui lumen-ui-types v0.4.3
0.1.12 0.4.4 lumen-ui lumen-ui-types v0.4.4"

WORK=$(mktemp -d)
# The map comes in on fd 3 so npm, gh and release.sh cannot read it off stdin.
while read -r new old ui types tag <&3; do
  for pair in "$types:lumen-ui-types" "$ui:lumen-ui"; do
    from=${pair%%:*}; to=${pair##*:}
    if npm view "@columenlabs/$to@$new" version > /dev/null 2>&1; then echo "@columenlabs/$to@$new is on npm"; continue; fi
    dir="$WORK/$to-$new"; mkdir -p "$dir"
    curl -fsSL "https://registry.npmjs.org/@columenlabs/$from/-/$from-$old.tgz" | tar xz -C "$dir"
    # The old names, in code and package.json alike, become the new ones.
    grep -rlE '@columenlabs/lumen(-types)?\b' "$dir/package" | while read -r f; do
      sed -i -E 's#@columenlabs/lumen-types\b#@columenlabs/lumen-ui-types#g; s#@columenlabs/lumen([^-a-z]|$)#@columenlabs/lumen-ui\1#g' "$f"
    done
    jq --arg v "$new" '.version = $v
      | if .dependencies["@columenlabs/lumen-ui-types"] then .dependencies["@columenlabs/lumen-ui-types"] = $v else . end' \
      "$dir/package/package.json" > "$dir/p.json" && mv "$dir/p.json" "$dir/package/package.json"
    (cd "$dir/package" && npm publish --access public --tag legacy)
  done
  # A run cut short may already have moved this tag.
  sha=$(git rev-list -n1 "$tag" 2> /dev/null || git rev-list -n1 "v$new")
  git tag -f "v$new" "$sha" > /dev/null
done 3<<< "$MAP"

for pkg in lumen-ui-types lumen-ui; do
  npm dist-tag add "@columenlabs/$pkg@0.1.12" latest
  npm dist-tag rm "@columenlabs/$pkg" legacy || true
  while read -r new old ui _ _ <&3; do
    [ "$ui" = lumen-ui ] || continue
    npm deprecate "@columenlabs/$pkg@$old" "Renumbered: this build is $pkg@$new"
  done 3<<< "$MAP"
done

# Tags: the new ones on the same commits, then the old ones go; each release moves to its new tag.
while read -r new _ _ _ tag <&3; do
  [ "$tag" = "v$new" ] && continue
  git push -q origin "v$new"
  id=$(gh api "repos/$REPO/releases/tags/$tag" --jq .id 2> /dev/null || true)
  [[ "$id" =~ ^[0-9]+$ ]] && gh api -X PATCH "repos/$REPO/releases/$id" -f tag_name="v$new" -f name="v$new" --silent
  git push -q origin ":refs/tags/$tag" 2> /dev/null || true
  git tag -d "$tag" > /dev/null 2>&1 || true
done 3<<< "$MAP"

# Every tag gets its release, notes written again with the new numbers.
while read -r new _ _ _ _ <&3; do
  REDO=1 scripts/release.sh "v$new" || echo "::warning::v$new has no release notes: Run workflow with tag v$new and redo"
done 3<<< "$MAP"
