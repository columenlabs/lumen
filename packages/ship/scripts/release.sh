#!/usr/bin/env bash
# Cut a repo's GitHub releases with notes Claude writes from the merged pull requests, through the
# GitHub REST API. Run from the repo's root, which holds lumen-ship.json (see the package README).
#   lumen-ship release            one patch release at main once `cadence.every` first-parent merges
#                                 landed since the latest release tag (`tags`, default v[0-9]*),
#                                 or on the first merge `cadence.days` days after it; FORCE=1
#                                 cuts it now
#   lumen-ship release minor      tag main as the next minor; its notes are the hand-written
#                                 docs/releases/v<major>.<minor>.0.md (required)
#   lumen-ship release notes      set the latest minor release's notes from its file again
#   lumen-ship release tag v1.2.3 make the release of a tag that already exists (a publish
#                                 workflow tagged it); REDO=1 writes its notes again
#   DRY_RUN=1 lumen-ship release  print what it would do, create nothing
# With `changelog.path` set, each release's Key takeaways are also committed to main as JSON
# (What's new reads them, @columenlabs/lumen-ship/releases) and the tag goes on that commit, so
# the release deploys its own notes. With `promote` set, that branch is fast-forwarded to the
# release. Needs gh with REST access to the repo, jq and curl; the notes need ANTHROPIC_API_KEY,
# and without one they are GitHub's own list of pull requests. Notes that name anything in
# LUMEN_FORBIDDEN_NAMES are asked again, then the release fails (for public repos).
set -euo pipefail
CONFIG=${LUMEN_SHIP_CONFIG:-lumen-ship.json}
[ -f "$CONFIG" ] || { echo "no $CONFIG here: run from the repo root (see lumen-ship's README)" >&2; exit 1; }
cfg() { jq -r "$1 // empty" "$CONFIG"; }
REPO=$(cfg .repo)
[ -n "$REPO" ] || { echo "$CONFIG needs repo (owner/name)" >&2; exit 1; }
PROMPT_FILE=$(cfg .notes.prompt)
[ -n "$PROMPT_FILE" ] && [ -f "$PROMPT_FILE" ] || { echo "$CONFIG notes.prompt must name a file" >&2; exit 1; }
MODEL=$(cfg .notes.model); MODEL=${MODEL:-claude-sonnet-5-5}
MAX_TOKENS=$(cfg .notes.maxTokens); MAX_TOKENS=${MAX_TOKENS:-16000}
CHANGELOG=$(cfg .changelog.path)
APPS=$(jq -c '.changelog.apps // {}' "$CONFIG")
PROMOTE=$(cfg .promote)
EVERY=${RELEASE_EVERY:-$(cfg .cadence.every)}; EVERY=${EVERY:-10}
DAYS=$(cfg .cadence.days); DAYS=${DAYS:-7}
# The release tags, as a git glob: narrow it when the repo keeps tags of an older scheme.
TAGS=$(cfg .tags); TAGS=${TAGS:-v[0-9]*}
DRY_RUN=${DRY_RUN:-0}
FORCE=${FORCE:-0}
REDO=${REDO:-0}
MODE=${1:-patch}
TMP=${RUNNER_TEMP:-/tmp}
git fetch -q origin main --tags

named() { # text: the forbidden names it carries, if any
  [ -n "${LUMEN_FORBIDDEN_NAMES:-}" ] || return 0
  grep -oiE "\b(${LUMEN_FORBIDDEN_NAMES})\b" <<< "$1" | sort -u | tr '\n' ' ' || true
}

notes() { # tag sha previous-tag: Claude's notes from the pull requests (or commits) between them
  local range=${3:+$3..}$2
  prs=$(git log --first-parent --format=%s "$range" | grep -oE '\(#[0-9]+\)$' | tr -dc '0-9\n' || true)
  pulls=$(for n in $prs; do
    gh api "repos/$REPO/pulls/$n" --jq '{number, title, body, login: .user.login}' \
      || { echo "could not read PR #$n" >&2; return 1; }
  done) || return 1
  if [ -n "$pulls" ]; then
    input=$(jq -r '"## #\(.number) \(.title)\n\((.body // "") | .[0:1500])\n"' <<< "$pulls")
    if [ -n "${LUMEN_FORBIDDEN_NAMES:-}" ]; then # titles are checked by no one: numbers only
      list=$(jq -r '"- #\(.number) by @\(.login)"' <<< "$pulls")
    else
      list=$(jq -r '"- #\(.number) \(.title) (@\(.login))"' <<< "$pulls")
    fi
    count="Pull requests ($(echo "$prs" | wc -w | tr -d ' '))"
  else # commits straight to main, like a first release: their messages stand in
    input=$(git log --first-parent --format='## %s%n%b' "$range" | cut -c1-1500)
    list=$(git log --first-parent --format='- %h' "$range")
    count="Commits ($(echo "$list" | wc -l | tr -d ' '))"
  fi
  prompt=$(sed "s/{tag}/$1/g" "$PROMPT_FILE")
  body=$(jq -n --arg model "$MODEL" --argjson max "$MAX_TOKENS" --arg text "$prompt"$'\n\n'"$input" \
    '{model: $model, max_tokens: $max, messages: [{role: "user", content: $text}]}')
  # The model thinks before it writes, so a small max_tokens runs out. Only a whole reply that
  # names nothing forbidden is published (a release once went out cut mid-sentence). Anything
  # else (max_tokens, a refusal, an error, a forbidden name) is asked again, at most 3 times.
  text=
  for attempt in 1 2 3; do
    reply=$(curl -sS https://api.anthropic.com/v1/messages \
      -H "x-api-key: $ANTHROPIC_API_KEY" -H 'anthropic-version: 2023-06-01' \
      -H 'content-type: application/json' -d "$body")
    text=$(jq -r 'if .stop_reason == "end_turn"
      then [.content[]? | select(.type == "text") | .text] | join("") else "" end' <<< "$reply")
    if [ -n "$text" ] && [ -n "$(named "$text")" ]; then
      echo "attempt $attempt named a forbidden name; asking again" >&2
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
  printf '\n\n## %s\n%s\n' "$count" "$list"
  [ -z "${3:-}" ] || printf '\nFull changelog: https://github.com/%s/compare/%s...%s\n' "$REPO" "$3" "$1"
}

write_notes() { # tag sha previous-tag [notes-file]: the notes for a release
  if [ -n "${4:-}" ]; then
    cat "$4"
  elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    notes "$1" "$2" "${3:-}" || { echo "Claude wrote no notes for $1" >&2; return 1; }
  else
    echo "ANTHROPIC_API_KEY is not set: the notes are GitHub's list of pull requests" >&2
    gh api -X POST "repos/$REPO/releases/generate-notes" -f tag_name="$1" -f target_commitish="$2" \
      ${3:+-f previous_tag_name="$3"} --jq .body
  fi
}

# Each Key takeaways bullet opens with its type tags, then app tags from changelog.apps:
# `- [Feature] [Fix] [Console] **Headline**: ...`. Type tags become the takeaway's chips, mapped
# app tags its `apps` (an app may show it only to people who can open one); unknown tags drop.
TAGS_JQ='map(capture("^(?<tags>(\\[[A-Za-z]+\\][ \t]*)*)(?<text>.*)$")
  | [.tags | scan("\\[([A-Za-z]+)\\]")[0] | ascii_downcase] as $tags
  | {text, types: [$tags[] | select(IN("feature", "improvement", "fix", "performance", "security"))] | unique,
     apps: [$tags[] | $apps[.] // empty] | unique}
  | if .apps == [] then del(.apps) else . end)'
changelog() { # tag published_at notes sha: commit the takeaways to main; prints the commit to tag
  [ -n "$CHANGELOG" ] || { echo "$4"; return; }
  bullets=$(printf '%s\n' "$3" | awk '
    /^#{1,3}[ \t]/ { if (inside) exit; inside = tolower($0) ~ /key takeaways/; next }
    inside && /^[ \t]*[-*][ \t]+/ { sub(/^[ \t]*[-*][ \t]+/, ""); print }' \
    | jq -R . | jq -s --argjson apps "$APPS" "$TAGS_JQ")
  commit=
  for attempt in 1 2 3; do
    file=$(gh api "repos/$REPO/contents/$CHANGELOG?ref=main") || break
    next=$(jq -r .content <<< "$file" | base64 -d | jq --arg tag "$1" --arg at "$2" --argjson t "$bullets" \
      '[{tag: $tag, published_at: $at, takeaways: $t}] + map(select(.tag != $tag))
       | sort_by(.published_at) | reverse')
    # A GITHUB_TOKEN commit starts no workflow, and the patch count skips `changelog:` commits.
    commit=$(gh api -X PUT "repos/$REPO/contents/$CHANGELOG" -f message="changelog: $1" -f branch=main \
      -f sha="$(jq -r .sha <<< "$file")" -f content="$(printf '%s\n' "$next" | base64 -w0)" \
      --jq '[.commit.sha, .commit.parents[0].sha] | join(" ")') && break
    commit=
    sleep $((attempt * 2))
  done
  [ -n "$commit" ] || echo "could not write $1 to $CHANGELOG" >&2
  read -r new parent <<< "${commit:-}"
  # Tag the changelog commit when it sits right on the release; else the release's own commit
  # (main moved, or the write failed: the release stands and the next one carries its notes).
  if [ "${parent:-}" = "$4" ]; then echo "$new"; else echo "$4"; fi
}

promote() { # sha: fast-forward the promote branch to it, creating it the first time
  [ -n "$PROMOTE" ] || return 0
  if gh api "repos/$REPO/git/ref/heads/$PROMOTE" > /dev/null 2>&1; then
    gh api -X PATCH "repos/$REPO/git/refs/heads/$PROMOTE" -f sha="$1" -F force=false > /dev/null
  else
    gh api -X POST "repos/$REPO/git/refs" -f ref="refs/heads/$PROMOTE" -f sha="$1" > /dev/null
  fi
  echo "$PROMOTE -> $(git log -1 --format='%h' "$1")"
}

release() { # tag sha previous-tag [notes-file]: a new tag and its release
  if [ "$DRY_RUN" = 1 ]; then
    echo "would cut $1 (since ${3:-the start}) at $(git log -1 --format='%h %s' "$2")"
    [ -z "$PROMOTE" ] || echo "and move $PROMOTE to it"
    return
  fi
  body=$(write_notes "$@") || exit 1
  bad=$(named "$body")
  [ -z "$bad" ] || { echo "$1 notes name $bad: not published" >&2; exit 1; }
  sha=$(changelog "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$body" "$2")
  at=$(gh api -X POST "repos/$REPO/releases" \
    -f tag_name="$1" -f target_commitish="$sha" -f name="$1" -f body="$body" --jq .published_at)
  echo "$1 $(git log -1 --format='%h %s' "$2" 2> /dev/null || echo "$sha") $at"
  promote "$sha"
}

LATEST=$(git tag --list "$TAGS" --sort=-v:refname | head -1)
case "$MODE" in
  tag)
    TAG=${2:?usage: lumen-ship release tag v<version>}
    git rev-parse -q --verify "refs/tags/$TAG" > /dev/null || { echo "no tag $TAG" >&2; exit 1; }
    PREV=$(git tag --list "$TAGS" --sort=-v:refname | awk -v t="$TAG" 'found { print; exit } $0 == t { found = 1 }')
    SHA=$(git rev-list -n1 "$TAG")
    # A tag with no release answers 404, whose error body gh still prints: keep only an id.
    ID=$(gh api "repos/$REPO/releases/tags/$TAG" --jq .id 2> /dev/null || true)
    [[ "$ID" =~ ^[0-9]+$ ]] || ID=
    if [ -n "$ID" ] && [ "$REDO" != 1 ]; then echo "$TAG already has a release"; exit; fi
    body=$(write_notes "$TAG" "$SHA" "$PREV") || exit 1
    bad=$(named "$body")
    [ -z "$bad" ] || { echo "$TAG notes name $bad: not published" >&2; exit 1; }
    if [ "$DRY_RUN" = 1 ]; then printf 'would release %s (since %s):\n\n%s\n' "$TAG" "${PREV:-the start}" "$body"; exit; fi
    if [ -n "$ID" ]; then
      gh api -X PATCH "repos/$REPO/releases/$ID" -f body="$body" --silent
      echo "$TAG notes written again"
    else
      gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f name="$TAG" -f body="$body" --jq .html_url
    fi
    ;;
  minor | notes)
    [ -n "$LATEST" ] || { echo "no v* tag yet: tag the first release by hand" >&2; exit 1; }
    IFS=. read -r MAJOR MINOR _ <<< "${LATEST#v}"
    if [ "$MODE" = minor ]; then
      TAG="v$MAJOR.$((MINOR + 1)).0"; PREV="v$MAJOR.$MINOR.0"
    else
      TAG="v$MAJOR.$MINOR.0"
    fi
    FILE="docs/releases/$TAG.md"
    git show "origin/main:$FILE" > "$TMP/notes.md" 2> /dev/null \
      || { echo "$FILE is not on main: write the key takeaways first" >&2; exit 1; }
    if [ "$MODE" = minor ]; then release "$TAG" "$(git rev-parse origin/main)" "$PREV" "$TMP/notes.md"; exit; fi
    if [ "$DRY_RUN" = 1 ]; then echo "would set $TAG notes from $FILE"; exit; fi
    id=$(gh api "repos/$REPO/releases/tags/$TAG" --jq .id)
    at=$(gh api -X PATCH "repos/$REPO/releases/$id" -F body=@"$TMP/notes.md" --jq .published_at)
    echo "$TAG notes set from $FILE ($at)"
    changelog "$TAG" "$at" "$(cat "$TMP/notes.md")" "" > /dev/null
    ;;
  patch)
    [ -n "$LATEST" ] || { echo "no v* tag yet: tag the first release by hand" >&2; exit 1; }
    IFS=. read -r MAJOR MINOR PATCH <<< "${LATEST#v}"
    # The changelog commits this script writes are not merges.
    COUNT=$(git rev-list --first-parent --count --invert-grep --grep='^changelog: ' "$LATEST..origin/main")
    if [ "$COUNT" = 0 ]; then echo "nothing merged since $LATEST"; exit; fi
    AGE_DAYS=$(( ($(date +%s) - $(git log -1 --format=%ct "$LATEST")) / 86400 ))
    if [ "$FORCE" != 1 ] && [ "$COUNT" -lt "$EVERY" ] && [ "$AGE_DAYS" -lt "$DAYS" ]; then
      echo "$COUNT of $EVERY merges, $AGE_DAYS of $DAYS days since $LATEST: no release yet"
      exit
    fi
    release "v$MAJOR.$MINOR.$((PATCH + 1))" "$(git rev-parse origin/main)" "$LATEST"
    ;;
  *)
    echo "usage: lumen-ship release [patch | minor | notes | tag v<version>]" >&2
    exit 1
    ;;
esac
