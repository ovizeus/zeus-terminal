#!/usr/bin/env bash
# zeus-claude-continue-current.sh
#
# Resume sesiunea Claude curentă bună pentru Zeus.
# Înlocuiește vechiul zeus-claude-continue.sh (acum .OBSOLETE-20260425).
#
# Diferența față de cel vechi:
#   - UUID nou (sesiunea curentă, nu cea precedentă)
#   - cwd=/root/zeus-terminal (NU /root) → bucket -root-zeus-terminal
#
# NU este cod runtime, NU intră în build. Pur recovery helper.
# Safe de șters dacă vrei să cureți.

set -u

PIN_UUID="70c70258-0ed1-4bf2-b9f3-debc4b629c4f"
PIN_CWD="/root/zeus-terminal"
PIN_BUCKET="$HOME/.claude/projects/-root-zeus-terminal"
PIN_JSONL="$PIN_BUCKET/${PIN_UUID}.jsonl"
RECOVERY_DOC="$PIN_CWD/SESSION_CLAUDE_PIN.md"

if [ ! -f "$PIN_JSONL" ]; then
  echo "[!] Sesiunea pinned nu mai există pe disc:"
  echo "    $PIN_JSONL"
  echo
  echo "Cauze posibile:"
  echo "  - ai pornit accidental o sesiune nouă din alt cwd"
  echo "  - jsonl-ul a fost mutat / șters"
  echo "  - bucket-ul s-a schimbat"
  echo
  echo "Fallback: picker interactiv din $PIN_CWD."
  cd "$PIN_CWD" || exit 1
  exec claude --resume
fi

echo "[i] Pinned Zeus session (CURRENT): $PIN_UUID"
echo "[i] cwd:    $PIN_CWD"
echo "[i] bucket: $PIN_BUCKET"
echo "[i] jsonl:  $PIN_JSONL"
echo "[i] mtime:  $(stat -c '%y' "$PIN_JSONL" | cut -d. -f1)"
echo "[i] size:   $(stat -c '%s' "$PIN_JSONL") bytes"
echo
echo "[i] Pin doc: $RECOVERY_DOC"
echo
echo "[i] Resume in 2 secunde — Ctrl+C ca să anulezi."
sleep 2

cd "$PIN_CWD" || exit 1
exec claude --resume "$PIN_UUID"
