#!/usr/bin/env bash
# Zeus migration — rollback to a pre-phase snapshot
#
# Usage:
#   bash scripts/rollback-to-phase.sh <phase-name> [--dry-run] [--force]
#
# Restores (from latest <phase-name> backup):
#   - DB (data/zeus.db) from db/zeus-<phase>-<ts>.db
#   - user_ctx + sync_user from userdata/<phase>-<ts>/
#   - public/app + public/js from build/<phase>-<ts>/
#   - git working tree reset to tag migration/phase-<phase>-pre
#   - pm2 reload zeus at the end
#
# --dry-run: print commands without executing
# --force:   skip interactive confirmation
#
# Exit codes: 0 ok, 1 usage, 2 not-found, 3 user-abort, 4 restore-fail

set -euo pipefail

REPO_ROOT="/root/zeus-terminal"
BACKUP_ROOT="/root/zeus-terminal-backups"
DB_PATH="${REPO_ROOT}/data/zeus.db"

DRY_RUN=0
FORCE=0
PHASE=""

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --force)   FORCE=1 ;;
        --help|-h)
            grep '^#' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        -*) echo "Unknown flag: $arg" >&2; exit 1 ;;
        *)  PHASE="$arg" ;;
    esac
done

if [[ -z "$PHASE" ]]; then
    echo "Usage: $0 <phase-name> [--dry-run] [--force]" >&2
    exit 1
fi

if [[ ! "$PHASE" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "ERROR: invalid phase name: $PHASE" >&2
    exit 1
fi

# ─── Run helper: executes, or echoes in dry-run mode ───
run() {
    if [[ $DRY_RUN -eq 1 ]]; then
        echo "  [dry-run] $*"
    else
        eval "$@"
    fi
}

echo "════════════════════════════════════════════════════════════"
echo "  Zeus rollback → phase=${PHASE} $([ $DRY_RUN -eq 1 ] && echo '[DRY-RUN]')"
echo "════════════════════════════════════════════════════════════"

# ─── Locate latest backup for this phase ───
DB_CAND="$(ls -1t "${BACKUP_ROOT}/db/zeus-${PHASE}-"*.db 2>/dev/null | head -1 || true)"
if [[ -z "$DB_CAND" ]]; then
    echo "ERROR: no DB backup found for phase '${PHASE}' in ${BACKUP_ROOT}/db/" >&2
    echo "Available phases with DB:" >&2
    ls -1 "${BACKUP_ROOT}/db/" 2>/dev/null | sed 's/^/  /' >&2 || echo "  (none)" >&2
    exit 2
fi

# Extract stamp (phase-TS) from filename: zeus-<phase>-<ts>.db
STAMP="$(basename "$DB_CAND" .db | sed 's/^zeus-//')"
USERDATA_SRC="${BACKUP_ROOT}/userdata/${STAMP}"
BUILD_SRC="${BACKUP_ROOT}/build/${STAMP}"
ARCHIVE_SRC="${BACKUP_ROOT}/archive/${STAMP}.tar.gz"
GIT_TAG="migration/phase-${PHASE}-pre"

echo "  DB snapshot:    ${DB_CAND}"
echo "  User data:      ${USERDATA_SRC}"
echo "  Build:          ${BUILD_SRC}"
echo "  Archive:        ${ARCHIVE_SRC}"
echo "  Git tag:        ${GIT_TAG}"
echo ""

# Verify presence
[[ -f "$DB_CAND" ]] || { echo "ERROR: DB backup missing" >&2; exit 2; }
[[ -d "$USERDATA_SRC" ]] || echo "WARN: userdata backup missing (will skip)"
[[ -d "$BUILD_SRC" ]] || echo "WARN: build backup missing (will skip)"

if ! git -C "$REPO_ROOT" rev-parse --verify "refs/tags/${GIT_TAG}" >/dev/null 2>&1; then
    echo "ERROR: git tag ${GIT_TAG} not found" >&2
    exit 2
fi

# ─── Verify checksums if present ───
if [[ -f "${DB_CAND}.sha256" ]]; then
    echo "[verify] DB checksum..."
    if [[ $DRY_RUN -eq 0 ]]; then
        (cd "$(dirname "$DB_CAND")" && sha256sum -c "$(basename "${DB_CAND}.sha256")") || { echo "ERROR: DB checksum mismatch" >&2; exit 4; }
    else
        echo "  [dry-run] would verify ${DB_CAND}.sha256"
    fi
fi

# ─── Confirmation ───
if [[ $DRY_RUN -eq 0 && $FORCE -eq 0 ]]; then
    echo ""
    echo "⚠  About to ROLLBACK the live system to phase '${PHASE}' (stamp ${STAMP})."
    echo "   This will:"
    echo "   - reset git working tree to ${GIT_TAG} (discarding uncommitted changes)"
    echo "   - overwrite ${DB_PATH}"
    echo "   - overwrite data/user_ctx/"
    echo "   - overwrite public/app/"
    echo "   - reload pm2 zeus"
    echo ""
    read -r -p "Type 'ROLLBACK' to confirm: " answer
    if [[ "$answer" != "ROLLBACK" ]]; then
        echo "Aborted."
        exit 3
    fi
fi

# ─── 1. Stop PM2 zeus (graceful) ───
echo "[pm2] stopping zeus..."
run "pm2 stop zeus || true"

# ─── 2. Git reset ───
echo "[git] resetting to ${GIT_TAG}..."
run "cd '${REPO_ROOT}' && git reset --hard '${GIT_TAG}'"

# ─── 3. DB restore ───
echo "[db] restoring ${DB_CAND} → ${DB_PATH}"
run "cp -a '${DB_CAND}' '${DB_PATH}.rollback-staging'"
run "mv '${DB_PATH}' '${DB_PATH}.pre-rollback-$(date +%s)'"
run "mv '${DB_PATH}.rollback-staging' '${DB_PATH}'"

# ─── 4. User data restore ───
if [[ -d "$USERDATA_SRC" ]]; then
    echo "[userdata] restoring ${USERDATA_SRC} → ${REPO_ROOT}/data/"
    if [[ -d "${USERDATA_SRC}/user_ctx" ]]; then
        run "rm -rf '${REPO_ROOT}/data/user_ctx'"
        run "cp -a '${USERDATA_SRC}/user_ctx' '${REPO_ROOT}/data/user_ctx'"
    fi
    if [[ -d "${USERDATA_SRC}/sync_user" ]]; then
        run "rm -rf '${REPO_ROOT}/data/sync_user'"
        run "cp -a '${USERDATA_SRC}/sync_user' '${REPO_ROOT}/data/sync_user'"
    fi
fi

# ─── 5. Build restore ───
if [[ -d "$BUILD_SRC" ]]; then
    echo "[build] restoring ${BUILD_SRC} → ${REPO_ROOT}/public/"
    if [[ -d "${BUILD_SRC}/app" ]]; then
        run "rm -rf '${REPO_ROOT}/public/app'"
        run "cp -a '${BUILD_SRC}/app' '${REPO_ROOT}/public/app'"
    fi
fi

# ─── 6. PM2 reload ───
echo "[pm2] restarting zeus..."
run "pm2 start zeus 2>/dev/null || pm2 reload zeus"
run "sleep 2"
run "pm2 status zeus"

echo ""
echo "════════════════════════════════════════════════════════════"
if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [DRY-RUN] no changes made"
else
    echo "  ✓ Rollback to phase '${PHASE}' complete (stamp ${STAMP})"
fi
echo "════════════════════════════════════════════════════════════"
