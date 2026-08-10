#!/usr/bin/env bash
# Apply supabase/migrations/ to the dev or prod database.
# The environment is baked into the argument — never inferred.
# Prod requires typing "yes" at the prompt as a last-mile safety net.
set -euo pipefail

TARGET="${1:-}"

if [ "$TARGET" != "dev" ] && [ "$TARGET" != "prod" ]; then
  echo "Usage: $0 <dev|prod>" >&2
  exit 2
fi

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found in $(pwd)" >&2
  exit 1
fi

# Export everything defined in .env.local so we can read the URLs below.
set -a
# shellcheck source=/dev/null
source .env.local
set +a

if [ "$TARGET" = "dev" ]; then
  URL="${SUPABASE_DEV_DB_URL:-}"
  if [ -z "$URL" ]; then
    echo "Error: SUPABASE_DEV_DB_URL is not set in .env.local" >&2
    exit 1
  fi
  echo "Applying migrations to DEV database..."
else
  URL="${SUPABASE_PROD_DB_URL:-}"
  if [ -z "$URL" ]; then
    echo "Error: SUPABASE_PROD_DB_URL is not set in .env.local" >&2
    exit 1
  fi
  echo
  echo "About to apply migrations to PRODUCTION."
  echo "Real user data lives on this database."
  echo
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

exec supabase db push --db-url "$URL"
