#!/usr/bin/env bash
# Apply supabase/migrations/ to the DEV database.
#
# PRODUCTION IS NO LONGER REACHABLE FROM HERE. Use:
#
#     npm run migrate:instances
#
# Not a style preference. There is one app deployment serving every
# instance, and this script only ever knew about one database. Pushing
# to production with it would migrate production and silently leave
# every other registered instance a release behind — which is the exact
# failure the migration runner exists to prevent, and it would happen
# without a word. The runner walks the registry, migrates each
# instance, verifies against the remote table, and exits nonzero if any
# instance was missed. See scripts/README.md.
#
# Dev stays here because the dev clone is not an instance: it is not in
# the registry, and the runner has no way to reach it.
set -euo pipefail

TARGET="${1:-}"

if [ "$TARGET" = "prod" ]; then
  cat >&2 <<'MSG'
Error: this script no longer pushes to production.

  Use:  npm run migrate:instances

  It applies pending migrations to every active instance in the
  registry, not just production, and refuses to report success if any
  instance was missed. Pushing to production alone leaves every other
  instance a release behind with nothing saying so.

  See scripts/README.md for the deploy order rule.
MSG
  exit 2
fi

if [ "$TARGET" != "dev" ]; then
  echo "Usage: $0 dev" >&2
  echo "       (for production: npm run migrate:instances)" >&2
  exit 2
fi

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found in $(pwd)" >&2
  exit 1
fi

# Export everything defined in .env.local so we can read the URL below.
set -a
# shellcheck source=/dev/null
source .env.local
set +a

URL="${SUPABASE_DEV_DB_URL:-}"
if [ -z "$URL" ]; then
  echo "Error: SUPABASE_DEV_DB_URL is not set in .env.local" >&2
  exit 1
fi

echo "Applying migrations to the DEV database..."
exec supabase db push --db-url "$URL"
