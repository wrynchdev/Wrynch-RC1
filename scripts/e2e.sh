#!/usr/bin/env bash
# Full browser test of the connected app against a throwaway local database.
# Needs PostgreSQL 15+ binaries and Playwright's Chromium (npx playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$PGBIN" ] || PGBIN=$(dirname "$(command -v initdb)")
DIR=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; "$PGBIN/pg_ctl" -D "$DIR/data" stop -m fast >/dev/null 2>&1 || su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then
  chown postgres "$DIR"
  su postgres -c "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null && $PGBIN/pg_ctl -D $DIR/data -o '-p 5496 -k $DIR -c listen_addresses=' -l $DIR/log start -w >/dev/null"
else
  "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
  "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p 5496 -k $DIR -c listen_addresses=" -l "$DIR/log" start -w >/dev/null
fi
export PGURL="postgresql://postgres@/postgres?host=$DIR&port=5496"
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f supabase/tests/shim.sql
for f in supabase/migrations/*.sql; do psql "$PGURL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
MOCK_PORT=54329 node supabase/tests/mock-supabase.mjs & PIDS+=($!)
PORT=5179 SUPABASE_URL=http://localhost:54329 SUPABASE_ANON_KEY=anon SUPABASE_SERVICE_ROLE_KEY=service APP_URL=http://localhost:5179 \
  ANTHROPIC_API_KEY= node --import tsx scripts/dev.mjs & PIDS+=($!)
sleep 3
PORT=5179 node tests/e2e/live.e2e.cjs
