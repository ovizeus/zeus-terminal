#!/usr/bin/env bash
# Zeus migration — pre-phase backup (idempotent, safe-to-rerun)
#
# Usage:
#   bash scripts/backup-pre-phase.sh <phase-name>
#     phase-name: alphanumeric + hyphens, e.g. "00" or "03-at-store"
#
# Produces:
#   /root/zeus-terminal-backups/git/<phase>-<ts>.info
#   /root/zeus-terminal-backups/db/zeus-<phase>-<ts>.db  (+ .sha256)
#   /root/zeus-terminal-backups/userdata/<phase>-<ts>/   (user_ctx + sync_user)
#   /root/zeus-terminal-backups/build/<phase>-<ts>/      (public/app + public/js)
#   /root/zeus-terminal-backups/archive/<phase>-<ts>.tar.gz  (source + config)
#   /root/zeus-terminal-backups/reports/<phase>-<ts>.report.txt
#
# Also creates git tag: migration/phase-<phase>-pre  (pointing at HEAD)
#
# Exit codes: 0 ok, 1 usage, 2 pre-check fail, 3 git fail, 4 db fail, 5 copy fail

set -euo pipefail

# ─── Config ───
REPO_ROOT="/root/zeus-terminal"
BACKUP_ROOT="/root/zeus-terminal-backups"
DB_PATH="${REPO_ROOT}/data/zeus.db"

# ─── Args ───
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <phase-name>" >&2
    echo "Example: $0 00" >&2
    echo "Example: $0 03-at-store" >&2
    exit 1
fi

PHASE="$1"
if [[ ! "$PHASE" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "ERROR: phase name must be alphanumeric + ._- only, got: $PHASE" >&2
    exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
STAMP="${PHASE}-${TS}"

# ─── Pre-checks ───
[[ -d "$REPO_ROOT/.git" ]] || { echo "ERROR: $REPO_ROOT is not a git repo" >&2; exit 2; }
[[ -d "$BACKUP_ROOT" ]] || { echo "ERROR: $BACKUP_ROOT missing; run setup first" >&2; exit 2; }
[[ -f "$DB_PATH" ]] || { echo "ERROR: DB not found at $DB_PATH" >&2; exit 2; }
command -v sqlite3 >/dev/null || { echo "ERROR: sqlite3 not installed" >&2; exit 2; }
command -v tar >/dev/null || { echo "ERROR: tar not installed" >&2; exit 2; }

cd "$REPO_ROOT"

echo "════════════════════════════════════════════════════════════"
echo "  Zeus pre-phase backup — phase=${PHASE} ts=${TS}"
echo "════════════════════════════════════════════════════════════"

# ─── 1. Git info + tag ───
GIT_HEAD="$(git rev-parse HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
GIT_DIRTY="clean"
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    GIT_DIRTY="dirty"
fi

GIT_TAG="migration/phase-${PHASE}-pre"
if git rev-parse --verify "refs/tags/${GIT_TAG}" >/dev/null 2>&1; then
    echo "[git] Tag ${GIT_TAG} already exists; skipping (re-run detected)"
else
    git tag "${GIT_TAG}" -m "Pre-phase ${PHASE} snapshot @ ${TS} | HEAD=${GIT_HEAD} branch=${GIT_BRANCH} wt=${GIT_DIRTY}" HEAD
    echo "[git] ✓ tag ${GIT_TAG} created on ${GIT_HEAD}"
fi

GIT_INFO="${BACKUP_ROOT}/git/${STAMP}.info"
{
    echo "phase=${PHASE}"
    echo "timestamp=${TS}"
    echo "branch=${GIT_BRANCH}"
    echo "head_sha=${GIT_HEAD}"
    echo "working_tree=${GIT_DIRTY}"
    echo "tag=${GIT_TAG}"
    echo "---"
    git status --short
    echo "---"
    git log --oneline -5
} > "${GIT_INFO}"
echo "[git] ✓ info → ${GIT_INFO}"

# ─── 2. DB snapshot via SQLite .backup (hot-safe) ───
DB_DST="${BACKUP_ROOT}/db/zeus-${STAMP}.db"
echo "[db] snapshotting ${DB_PATH} → ${DB_DST}"
sqlite3 "${DB_PATH}" ".backup '${DB_DST}'" || { echo "ERROR: sqlite .backup failed" >&2; exit 4; }
INTEGRITY="$(sqlite3 "${DB_DST}" "PRAGMA integrity_check;" | head -1)"
if [[ "${INTEGRITY}" != "ok" ]]; then
    echo "ERROR: DB integrity check failed: ${INTEGRITY}" >&2
    exit 4
fi
sha256sum "${DB_DST}" > "${DB_DST}.sha256"
DB_SIZE="$(du -h "${DB_DST}" | awk '{print $1}')"
echo "[db] ✓ ${DB_DST} (${DB_SIZE}, integrity=${INTEGRITY})"

# ─── 3. User data ───
USERDATA_DST="${BACKUP_ROOT}/userdata/${STAMP}"
mkdir -p "${USERDATA_DST}"
if [[ -d "${REPO_ROOT}/data/user_ctx" ]]; then
    cp -a "${REPO_ROOT}/data/user_ctx" "${USERDATA_DST}/" || { echo "ERROR: user_ctx copy failed" >&2; exit 5; }
fi
if [[ -d "${REPO_ROOT}/data/sync_user" ]]; then
    cp -a "${REPO_ROOT}/data/sync_user" "${USERDATA_DST}/" 2>/dev/null || true
fi
if [[ -f "${REPO_ROOT}/data/audit.jsonl" ]]; then
    tail -n 10000 "${REPO_ROOT}/data/audit.jsonl" > "${USERDATA_DST}/audit.tail.jsonl" || true
fi
[[ -f "${REPO_ROOT}/data/metrics_snapshot.json" ]] && cp -a "${REPO_ROOT}/data/metrics_snapshot.json" "${USERDATA_DST}/" 2>/dev/null || true
[[ -f "${REPO_ROOT}/data/riskState.json" ]] && cp -a "${REPO_ROOT}/data/riskState.json" "${USERDATA_DST}/" 2>/dev/null || true
USERDATA_SIZE="$(du -sh "${USERDATA_DST}" | awk '{print $1}')"
echo "[userdata] ✓ ${USERDATA_DST} (${USERDATA_SIZE})"

# ─── 4. Live build snapshot ───
BUILD_DST="${BACKUP_ROOT}/build/${STAMP}"
mkdir -p "${BUILD_DST}"
if [[ -d "${REPO_ROOT}/public/app" ]]; then
    cp -a "${REPO_ROOT}/public/app" "${BUILD_DST}/" || { echo "ERROR: public/app copy failed" >&2; exit 5; }
fi
if [[ -d "${REPO_ROOT}/public/js" ]]; then
    cp -a "${REPO_ROOT}/public/js" "${BUILD_DST}/" 2>/dev/null || true
fi
if [[ -f "${REPO_ROOT}/server/version.js" ]]; then
    cp -a "${REPO_ROOT}/server/version.js" "${BUILD_DST}/" 2>/dev/null || true
fi
BUILD_SIZE="$(du -sh "${BUILD_DST}" | awk '{print $1}')"
echo "[build] ✓ ${BUILD_DST} (${BUILD_SIZE})"

# ─── 5. Source archive (tar.gz) ───
ARCHIVE_DST="${BACKUP_ROOT}/archive/${STAMP}.tar.gz"
echo "[archive] creating ${ARCHIVE_DST}"

# Build include list: required entries + optional files that actually exist.
INCLUDES=(
    client/src
    server
    public/app
    public/js
    scripts
    package.json
    package-lock.json
    ecosystem.config.js
)
for f in .env .env.example ecosystem.config.cjs tsconfig.json vite.config.ts; do
    if [[ -f "${REPO_ROOT}/${f}" ]]; then
        INCLUDES+=("${f}")
    fi
done

tar --exclude='node_modules' \
    --exclude='.backups' \
    --exclude='public/app.BAK-before-restore' \
    --exclude='client/src/.backups' \
    --exclude='data/db_backups' \
    -czf "${ARCHIVE_DST}" \
    -C "${REPO_ROOT}" \
    "${INCLUDES[@]}" \
    2>/dev/null || { echo "ERROR: tar failed" >&2; exit 5; }

sha256sum "${ARCHIVE_DST}" > "${ARCHIVE_DST}.sha256"
ARCHIVE_SIZE="$(du -h "${ARCHIVE_DST}" | awk '{print $1}')"
echo "[archive] ✓ ${ARCHIVE_DST} (${ARCHIVE_SIZE})"

# ─── 6. Report (A.6 format) ───
REPORT="${BACKUP_ROOT}/reports/${STAMP}.report.txt"
{
    echo "════════════════════════════════════════════════════════════"
    echo " ZEUS PRE-PHASE BACKUP REPORT"
    echo "════════════════════════════════════════════════════════════"
    echo " Phase:            ${PHASE}"
    echo " Timestamp:        ${TS}"
    echo ""
    echo " Git branch:       ${GIT_BRANCH}"
    echo " Git HEAD SHA:     ${GIT_HEAD}"
    echo " Working tree:     ${GIT_DIRTY}"
    echo " Git tag:          ${GIT_TAG}"
    echo ""
    echo " Artifacts:"
    echo "   git info:       ${GIT_INFO}"
    echo "   DB snapshot:    ${DB_DST} (${DB_SIZE})"
    echo "   DB integrity:   ${INTEGRITY}"
    echo "   User data:      ${USERDATA_DST} (${USERDATA_SIZE})"
    echo "   Build:          ${BUILD_DST} (${BUILD_SIZE})"
    echo "   Archive:        ${ARCHIVE_DST} (${ARCHIVE_SIZE})"
    echo ""
    echo " Rollback command:"
    echo "   bash ${REPO_ROOT}/scripts/rollback-to-phase.sh ${PHASE}"
    echo ""
    echo " Verify integrity:"
    echo "   sha256sum -c ${DB_DST}.sha256"
    echo "   sha256sum -c ${ARCHIVE_DST}.sha256"
    echo "════════════════════════════════════════════════════════════"
} | tee "${REPORT}"
echo ""
echo "[✓] Backup complete. Report: ${REPORT}"
