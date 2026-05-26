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

# --- BACKUP_PASSPHRASE: env wins (CI), else read from .env.local (local) -----
# In CI the secret arrives as an env var (a GitHub secret); locally it lives in
# .env.local. If it's already set in the environment we use it as-is and never
# touch .env.local (which won't exist in CI). Reading from .env.local parses
# only the one line rather than sourcing the file (sourcing would execute
# arbitrary content). openssl reads it via `-pass env:` so the secret never
# appears in argv / `ps` either way.
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  if [ ! -f .env.local ]; then
    echo "ERROR: BACKUP_PASSPHRASE not in env and .env.local not found." >&2
    exit 1
  fi
  BACKUP_PASSPHRASE="$(grep -E '^BACKUP_PASSPHRASE=' .env.local | head -n1 | cut -d= -f2- || true)"
  # Strip a trailing CR (CRLF files) and any wrapping quotes.
  BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE%$'\r'}"
  BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE%\"}"; BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE#\"}"
  BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE%\'}"; BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE#\'}"
fi
export BACKUP_PASSPHRASE
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_PASSPHRASE is missing/empty (checked env and .env.local) —" >&2
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

# --- Dump target: BACKUP_DB_URL (CI, backup_ro) wins; else --linked (local) --
# Same `supabase db dump` + flags either way, so the output shape — and thus the
# proven restore — is identical. CI passes the least-privilege backup_ro
# connection string; locally we fall back to the linked CLI state (postgres).
if [ -n "${BACKUP_DB_URL:-}" ]; then
  DUMP_TARGET=(--db-url "$BACKUP_DB_URL")
  echo "[backup] dump target: --db-url (headless / backup_ro)"
else
  DUMP_TARGET=(--linked)
  echo "[backup] dump target: --linked (local CLI state)"
fi

echo "[backup] dumping schema…"
supabase db dump "${DUMP_TARGET[@]}" -f "$TMP/schema.sql"

echo "[backup] dumping data…"
supabase db dump "${DUMP_TARGET[@]}" --data-only --use-copy -f "$TMP/data.sql"

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
