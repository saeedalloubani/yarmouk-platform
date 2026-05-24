#!/usr/bin/env bash
#
# scripts/backup.sh — manual encrypted database backup (v1, DB-only).
#
# Produces  backups/yarmouk-YYYYMMDD-HHMM.yarmoukbackup :
#   supabase db dump --linked (schema + data)  ->  tar.gz  ->  openssl AES-256-CBC
#   encrypted with $BACKUP_PASSPHRASE (read from .env.local).
#
# DB-ONLY (text-first v1): the recordings Storage bucket (audio) is NOT
# included — add a Storage download step here when interviews start being
# recorded. Vault key, auth.users, and Storage objects are NOT in the dump.
#
# A RESTORE needs THREE things, stored SEPARATELY (none is in this file):
#   1. the .yarmoukbackup archive (this output)
#   2. BACKUP_PASSPHRASE (password manager) — to decrypt the archive at all
#   3. Vault key pii_key_v1 (password manager) — to read PII columns; without
#      it the analytical dataset still restores, PII stays unreadable ciphertext
# See RUNBOOK "Backup & restore".
#
# Run:  npm run backup   (or: bash scripts/backup.sh)

set -euo pipefail

# Run from repo root regardless of caller's CWD.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Read BACKUP_PASSPHRASE from .env.local (value never echoed) ------------
# Read only the one line rather than sourcing the whole file (sourcing would
# execute arbitrary content and export every key). openssl reads it via
# `-pass env:` so the secret never appears in argv / `ps`.
if [ ! -f .env.local ]; then
  echo "ERROR: .env.local not found — cannot read BACKUP_PASSPHRASE." >&2
  exit 1
fi
BACKUP_PASSPHRASE="$(grep -E '^BACKUP_PASSPHRASE=' .env.local | head -n1 | cut -d= -f2- || true)"
# Strip a trailing CR (CRLF files) and any wrapping quotes.
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE%$'\r'}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE%\"}"; BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE#\"}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE%\'}"; BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE#\'}"
export BACKUP_PASSPHRASE
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_PASSPHRASE is missing/empty in .env.local —" >&2
  echo "       refusing to write an unencrypted or empty backup." >&2
  exit 1
fi

# --- Temp working dir; removed on ANY exit so plaintext dumps never linger ---
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p backups
TS="$(date +%Y%m%d-%H%M)"
OUT="backups/yarmouk-$TS.yarmoukbackup"

echo "[backup] dumping schema…"
supabase db dump --linked -f "$TMP/schema.sql"

echo "[backup] dumping data…"
supabase db dump --linked --data-only --use-copy -f "$TMP/data.sql"

echo "[backup] compressing…"
tar -czf "$TMP/dump.tar.gz" -C "$TMP" schema.sql data.sql

echo "[backup] encrypting (AES-256-CBC, pbkdf2)…"
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$TMP/dump.tar.gz" \
  -out "$OUT" \
  -pass env:BACKUP_PASSPHRASE

SIZE="$(du -h "$OUT" | cut -f1)"

cat <<EOF

[backup] DONE.
  File: $OUT  ($SIZE)

  ➜ Copy this file OFFSITE to your Mac backup location NOW. The backups/ dir is
    gitignored and lives INSIDE the project — that is not an offsite copy.

  A restore needs ALL THREE, stored separately:
    1. this .yarmoukbackup file
    2. BACKUP_PASSPHRASE  (password manager)  — decrypts the archive
    3. Vault key pii_key_v1 (password manager) — reads PII columns; without it
       the analytical dataset still restores, PII stays unreadable ciphertext
  See RUNBOOK "Backup & restore".
EOF
