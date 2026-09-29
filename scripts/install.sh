#!/bin/sh
# dsh-genui one-shot installer (installs the public npm package, no npm account needed)
#
# Usage:
#   ./scripts/install.sh            # install into the default web profile
#   ./scripts/install.sh tui        # install into a custom profile
#
# What it does: check two prerequisites (dsh / pnpm) → install the plugin from
# npm → sync the genui skill (with file-safety boundaries) → prompt a restart
# to verify. The only difference from a manual install is the extra
# prerequisite self-check; the install command itself matches the README.

set -eu

PROFILE="${1:-web}"

# ── the profile argument accepts safe characters only (it is spliced into ──
# ── paths and node environment variables below) ──
case "$PROFILE" in
  *[!a-zA-Z0-9_-]*|'') fail_early=1 ;;
  *) fail_early=0 ;;
esac
if [ "$fail_early" = 1 ]; then
  printf '\033[31m✗ illegal profile name "%s" (only letters, digits, _ and - are allowed)\033[0m\n' "$PROFILE"
  exit 1
fi

PACKAGE_SPEC="@changfenhuang/dsh-genui"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
# The Web session's skill service discovers skills under agentsHome (default
# ~/.agents); dshHome's ~/.dsh/skills no longer enters the session directory in
# some host evolutions — so sync BOTH roots and the model finds the genui skill
# whichever root it reads.
AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; BOLD='\033[1m'; NC='\033[0m'

fail() { printf "${RED}✗ %s${NC}\n" "$1"; exit 1; }
ok()   { printf "${GREEN}✓ %s${NC}\n" "$1"; }
warn() { printf "${YELLOW}! %s${NC}\n" "$1"; }

# ── skill sync: the model reads SKILL.md from a skill root, not the repo copy ──
# Resolve SKILL.md inside the installed package (a normal install resolves to
# npm; a dev link install resolves to the local checkout). The target is handled
# across seven states and NEVER follows a link to write someone else's file:
#   missing / plain file  → same-directory temp file + atomic mv (create or replace)
#   symlink to the same file  → succeed and skip, leaving the link alone (dev ln -s)
#   symlink to another file   → fail safely, showing the target
#   dangling symlink          → fail safely
#   directory                 → fail safely
sync_skill_to() {
  SKILL_FILE="$1"
  DEST="$2"
  DEST_LABEL="$3"

  # Symlink detection (readlink resolves once; a relative target expands
  # against the directory holding the link)
  if [ -L "$DEST" ]; then
    LINK_TARGET=$(readlink "$DEST")
    case "$LINK_TARGET" in
      /*) RESOLVED="$LINK_TARGET" ;;
      *)  RESOLVED="$(cd "$(dirname "$DEST")" && pwd -P)/$LINK_TARGET" ;;
    esac
    # Same file → skip (the dev ln -s checkout case). String comparison plus a
    # canonical comparison as a backstop (paths differing by /var vs
    # /private/var, `..` segments and the like).
    canonical() {
      ( cd "$(dirname "$1")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$1")" ) || printf '%s\n' "$1"
    }
    if [ "$RESOLVED" = "$SKILL_FILE" ] || [ "$(canonical "$RESOLVED")" = "$(canonical "$SKILL_FILE")" ]; then
      ok "skill is already up to date ($DEST_LABEL is a symlink to the same file)"
      return 0
    fi
    if [ -e "$RESOLVED" ] || [ -L "$RESOLVED" ]; then
      fail "target $DEST is a symlink to another file (-> ${RESOLVED}); refusing to write. Handle it manually and retry."
    fi
    fail "target $DEST is a dangling symlink (-> ${RESOLVED}); refusing to write. Handle it manually and retry."
  fi
  if [ -d "$DEST" ]; then
    fail "target $DEST is a directory; refusing to overwrite. Handle it manually and retry."
  fi

  # Missing / plain file: same-directory temp file + atomic mv; an abnormal exit
  # cleans the temp file up
  mkdir -p "$(dirname "$DEST")"
  TMP_FILE="$DEST.tmp.$$"
  trap 'rm -f "$TMP_FILE"' EXIT HUP INT TERM
  cp "$SKILL_FILE" "$TMP_FILE"
  mv "$TMP_FILE" "$DEST"
  trap - EXIT HUP INT TERM
  ok "skill synced to ${DEST_LABEL} (${SKILL_FILE})"
}

sync_skill() {
  echo "Syncing the genui skill ..."
  # User-controlled paths travel to node through environment variables and are
  # never spliced into a -e string (injection safety). cd to a neutral directory
  # before resolving: running the script inside the plugin checkout makes node's
  # self-reference resolve the package name back to the current repo, which must
  # be avoided.
  mkdir -p "$DSH_HOME"
  SKILL_FILE=$(cd "$DSH_HOME" && DSH_HOME="$DSH_HOME" PROFILE="$PROFILE" node -e "
const path = require('path')
try {
  const pkg = require.resolve('@changfenhuang/dsh-genui/package.json', { paths: [process.env.DSH_HOME + '/profiles/' + process.env.PROFILE] })
  console.log(path.join(path.dirname(pkg), 'SKILL.md'))
} catch { process.exit(1) }
" 2>/dev/null || true)
  if [ -z "$SKILL_FILE" ] || [ ! -f "$SKILL_FILE" ]; then
    fail "cannot locate SKILL.md inside the installed package — the install is incomplete; fix the plugin install and retry."
  fi

  sync_skill_to "$SKILL_FILE" "$DSH_HOME/skills/genui/SKILL.md" "DSH_HOME/skills/genui"
  sync_skill_to "$SKILL_FILE" "$AGENTS_HOME/skills/genui/SKILL.md" "AGENTS_HOME/skills/genui"
}

echo "${BOLD}== dsh-genui install (profile: ${PROFILE}) ==${NC}"

# ── prerequisite 1: dsh ────────────────────────────────────────────────────
if ! command -v dsh >/dev/null 2>&1; then
  fail "dsh command not found. Install DeepSeek Harness (open-source edition) first, then rerun this script."
fi
ok "dsh: $(dsh --version 2>/dev/null || echo present)"

# ── prerequisite 2: pnpm (when missing, only advise — never run corepack ──
# ── enable automatically and change the user's global setup) ──
if ! command -v pnpm >/dev/null 2>&1; then
  fail "pnpm not found. Run 'corepack enable' (or 'npm i -g pnpm') yourself, open a new terminal, confirm 'pnpm -v' prints something, then rerun this script."
fi
ok "pnpm: $(pnpm --version)"

# ── already-installed detection (idempotent) ───────────────────────────────
PROFILE_PKG="$DSH_HOME/profiles/$PROFILE/package.json"
if [ -f "$PROFILE_PKG" ] && grep -q "dsh-genui" "$PROFILE_PKG" 2>/dev/null; then
  warn "The plugin is already in profile '$PROFILE'."
  sync_skill
  printf "  To reinstall manually, run: dsh plugin --profile %s remove @changfenhuang/dsh-genui, then rerun this script.\n" "$PROFILE"
  printf "  Otherwise simply: restart dsh web + hard refresh to verify.\n"
  exit 0
fi

# ── install ───────────────────────────────────────────────────────────────
echo "Installing (pulling the public package from npm and installing dependencies)..."
dsh plugin --profile "$PROFILE" add "$PACKAGE_SPEC"
sync_skill

echo
ok "Install complete!"
echo
echo "${BOLD}Next:${NC}"
echo "  1. Restart dsh web (exit, then run dsh web again)"
echo "  2. Hard refresh the browser (Cmd+Shift+R)"
echo "  3. In a new session say: draw a stats dashboard with dsh-ui"
echo
