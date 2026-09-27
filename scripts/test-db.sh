#!/usr/bin/env bash
# Load the migrations into a throwaway PostgreSQL and run the permission/rule tests.
# Uses $DATABASE_URL if set (CI); otherwise starts a temporary local server (needs PostgreSQL 15+ binaries).
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  psql "$1" -v ON_ERROR_STOP=1 -q -f supabase/tests/shim.sql
  for f in supabase/migrations/*.sql; do psql "$1" -v ON_ERROR_STOP=1 -q -f "$f"; done
  psql "$1" -v ON_ERROR_STOP=1 -q -o /dev/null -f supabase/tests/rules.test.sql
}

if [ -n "${DATABASE_URL:-}" ]; then run "$DATABASE_URL"; exit 0; fi

PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$PGBIN" ] || PGBIN=$(dirname "$(command -v initdb)")
DIR=$(mktemp -d)
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then
  chown postgres "$DIR"
  su postgres -c "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null && $PGBIN/pg_ctl -D $DIR/data -o '-p 5498 -k $DIR -c listen_addresses=' -l $DIR/log start -w >/dev/null"
else
  "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
  "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p 5498 -k $DIR -c listen_addresses=" -l "$DIR/log" start -w >/dev/null
fi
run "postgresql://postgres@/postgres?host=$DIR&port=5498"
