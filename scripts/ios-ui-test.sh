#!/usr/bin/env bash
# The iOS app's whole technician flow against a throwaway local server (the same stand-ins as the browser test).
#   scripts/ios-ui-test.sh <simulator udid>     on a Mac with Xcode, after `npm run ios:domain` and `xcodegen`
#   scripts/ios-ui-test.sh --server-only        start and seed the server, run the checks, then stop (any OS)
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
  su postgres -c "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null && $PGBIN/pg_ctl -D $DIR/data -o '-p 5497 -k $DIR -c listen_addresses=' -l $DIR/log start -w >/dev/null"
else
  "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
  "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p 5497 -k $DIR -c listen_addresses=" -l "$DIR/log" start -w >/dev/null
fi
export PGURL="postgresql://postgres@/postgres?host=$DIR&port=5497"
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f supabase/tests/shim.sql
for f in supabase/migrations/*.sql; do psql "$PGURL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
MOCK_PORT=54339 node supabase/tests/mock-supabase.mjs & PIDS+=($!)
PORT=5189 SUPABASE_URL=http://localhost:54339 SUPABASE_ANON_KEY=anon SUPABASE_SERVICE_ROLE_KEY=service APP_URL=http://localhost:5189 \
  ANTHROPIC_API_KEY= OPENAI_API_KEY= AI_STUB=1 node --import tsx scripts/dev.mjs >/dev/null & PIDS+=($!)
for i in $(seq 1 60); do curl -sf http://localhost:5189/api/app-config >/dev/null && break; sleep 1; done
curl -sf http://localhost:5189/api/app-config >/dev/null || { echo "server didn't start"; exit 1; }
MOCK=http://localhost:54339 node --import tsx tests/ios/seed.mjs

if [ "${1:-}" != "--server-only" ]; then
  xcodebuild test -project ios/Wrynch.xcodeproj -scheme WrynchUI -destination "id=$1" CODE_SIGNING_ALLOWED=NO \
    WRYNCH_UI_SERVER=1 2>&1 | tee xcodebuild-ui.log | grep -E "error:|Test Case .*(passed|failed)|\*\* TEST" || true
  grep -q "\*\* TEST SUCCEEDED \*\*" xcodebuild-ui.log || { grep -E ": error:|error: -\[|failed \(" xcodebuild-ui.log | sed -E 's#^.*/ios/##' | awk '!seen[$0]++' | head -10 | sed 's/^/::error::/'; exit 1; }
fi

# What the app did must be in the database: the inspection started and the point's parts were rated OK.
STATUS=$(psql "$PGURL" -X -t -A -c "select status from inspection limit 1")
OKS=$(psql "$PGURL" -X -t -A -c "select count(*) from check_result where rating = 'ok'")
echo "inspection status: $STATUS, OK results: $OKS"
if [ "${1:-}" != "--server-only" ]; then
  [ "$STATUS" = "in_progress" ] || { echo "::error::the inspection wasn't started from the app ($STATUS)"; exit 1; }
  [ "$OKS" -ge 1 ] || { echo "::error::no OK results were saved from the app"; exit 1; }
fi
echo "iOS UI flow checked"
