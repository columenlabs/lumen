#!/usr/bin/env bash
# Make the GitHub release for a published version tag, its notes written by Claude.
#   scripts/release.sh v0.4.1           release v0.4.1 with notes on what changed since the tag
#                                       before it; a tag that already has a release is left alone
#   REDO=1 scripts/release.sh v0.4.1    write that release's notes again
#   DRY_RUN=1 scripts/release.sh v0.4.1 print the notes, create nothing
# .github/workflows/publish.yml runs it after each merge publishes and tags a version (OpenShip's
# runner on arm-01). Needs gh with REST access to the repo, jq, and ANTHROPIC_API_KEY; without a
# key the notes are GitHub's own list of pull requests. Notes that name a product in
# LUMEN_FORBIDDEN_NAMES are written again, then the release fails: this repo is public.
set -euo pipefail
TAG=${1:?usage: scripts/release.sh v<version>}
DRY_RUN=${DRY_RUN:-0}
REDO=${REDO:-0}
MODEL=claude-sonnet-5-5
REPO=columenlabs/lumen-ui
git fetch -q origin main --tags
git rev-parse -q --verify "refs/tags/$TAG" > /dev/null || { echo "no tag $TAG" >&2; exit 1; }
PREV=$(git tag --list 'v*' --sort=-v:refname | awk -v t="$TAG" 'found { print; exit } $0 == t { found = 1 }')
SHA=$(git rev-list -n1 "$TAG")
# A tag with no release answers 404, whose error body gh still prints: keep only an id.
ID=$(gh api "repos/$REPO/releases/tags/$TAG" --jq .id 2> /dev/null || true)
[[ "$ID" =~ ^[0-9]+$ ]] || ID=
if [ -n "$ID" ] && [ "$REDO" != 1 ]; then echo "$TAG already has a release"; exit; fi

named() { # text: the product names it carries, if any
  [ -n "${LUMEN_FORBIDDEN_NAMES:-}" ] || return 0
  grep -oiE "\b(${LUMEN_FORBIDDEN_NAMES})\b" <<< "$1" | sort -u | tr '\n' ' ' || true
}

notes() { # Key takeaways and changes by part, from the pull requests since PREV
  prs=$(git log --first-parent --format=%s ${PREV:+"$PREV.."}"$SHA" | grep -oE '\(#[0-9]+\)$' | tr -dc '0-9\n')
  pulls=$(for n in $prs; do
    gh api "repos/$REPO/pulls/$n" --jq '{number, title, body, login: .user.login}' \
      || { echo "could not read PR #$n" >&2; return 1; }
  done) || return 1
  [ -n "$pulls" ] || { echo "No pull requests since ${PREV:-the start}."; return; }
  input=$(jq -r '"## #\(.number) \(.title)\n\((.body // "") | .[0:1500])\n"' <<< "$pulls")
  list=$(jq -r '"- #\(.number) by @\(.login)"' <<< "$pulls") # titles are checked by no one: numbers only
  prompt="Write the GitHub release notes for Lumen $TAG, an open-source React component kit published to npm \
as @columenlabs/lumen-ui (components) and @columenlabs/lumen-ui-types (its view model types). It covers the merged pull requests below. \
Start with '## Key takeaways': 3 to 5 bullets, each opening with one or more type tags from [Feature] [Improvement] [Fix] [Performance] [Security] [Breaking] \
(e.g. '- [Feature] **Headline**: sentence'), then a bold one-line headline, then one plain sentence on what a developer using the kit can now do. \
Write each bullet for a developer who has never seen the change: the sentence must say where it lives, by the exported part and the prop, \
option or slot they would use (e.g. 'In LumenView, the new \`pivot\` option ...', 'LumenChart's \`indicators\` prop now ...', \
'From @columenlabs/lumen-ui-types/views, \`customViewConfigSchema\` ...'). A [Breaking] bullet says what to change in an app. \
Then one '## <area>' section per area touched (Shell, Layout and widgets, Tables and views, Charts, Pickers and forms, Types, Theme, Docs, Tooling), \
a few short bullets each in plain words, merging related pull requests. \
This repo is public and the kit names no product: never name an app, product or company that uses the kit, even if a pull request does; \
say 'an app' instead. No PR numbers, no file paths, no vendor names. Output only the markdown."
  body=$(jq -n --arg model "$MODEL" --arg text "$prompt"$'\n\n'"$input" \
    '{model: $model, max_tokens: 16000, messages: [{role: "user", content: $text}]}')
  # Only a whole reply that names no product is published. Anything else (max_tokens, a refusal,
  # an error, a product name) is asked again, at most 3 times, then fails the release.
  text=
  for attempt in 1 2 3; do
    reply=$(curl -sS https://api.anthropic.com/v1/messages \
      -H "x-api-key: $ANTHROPIC_API_KEY" -H 'anthropic-version: 2023-06-01' \
      -H 'content-type: application/json' -d "$body")
    text=$(jq -r 'if .stop_reason == "end_turn"
      then [.content[]? | select(.type == "text") | .text] | join("") else "" end' <<< "$reply")
    if [ -n "$text" ] && [ -n "$(named "$text")" ]; then
      echo "attempt $attempt named a product; asking again" >&2
      text=
    elif [ -z "$text" ]; then
      # show why, without the key
      jq -c '{type, error, stop_reason, model, blocks: [.content[]?.type]}' <<< "$reply" >&2
    fi
    [ -n "$text" ] && break
    sleep $((attempt * 5))
  done
  [ -n "$text" ] || return 1
  printf '%s' "$text"
  printf '\n\n## Pull requests (%s)\n%s\n\n' "$(echo "$prs" | wc -w | tr -d ' ')" "$list"
  [ -z "$PREV" ] || printf 'Full changelog: https://github.com/%s/compare/%s...%s\n' "$REPO" "$PREV" "$TAG"
}

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  NOTES=$(notes) || { echo "Claude wrote no notes for $TAG" >&2; exit 1; }
else
  echo "ANTHROPIC_API_KEY is not set: the notes are GitHub's list of pull requests" >&2
  NOTES=$(gh api -X POST "repos/$REPO/releases/generate-notes" -f tag_name="$TAG" \
    ${PREV:+-f previous_tag_name="$PREV"} --jq .body)
fi
bad=$(named "$NOTES")
[ -z "$bad" ] || { echo "$TAG notes name $bad: not published (this repo is public)" >&2; exit 1; }

if [ "$DRY_RUN" = 1 ]; then printf 'would release %s (since %s):\n\n%s\n' "$TAG" "${PREV:-the start}" "$NOTES"; exit; fi
if [ -n "$ID" ]; then
  gh api -X PATCH "repos/$REPO/releases/$ID" -f body="$NOTES" --silent
  echo "$TAG notes written again"
else
  gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f name="$TAG" -f body="$NOTES" --jq .html_url
fi
