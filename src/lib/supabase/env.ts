// Central place to read app-level config from process.env.
//
// Only NEXT_PUBLIC_APP_URL lives here now. The Supabase URL and keys
// used to be read here too, and are not any more: which database a
// request talks to is resolved once in middleware and travels down
// the request as an InstanceConfig (see src/lib/instances/). Reading
// them from the environment at the point of use is precisely the
// thing that made one deployment mean one database.
//
// The one remaining reader of NEXT_PUBLIC_SUPABASE_* is the seed
// scripts, which run outside Next against an explicit --env-file and
// build their own clients.
//
// Throwing here surfaces a missing variable at first use instead of
// producing a mystifying 401 from somewhere downstream.

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`
    );
  }
  return value;
}

// Referenced statically, not via a dynamic key: Next.js only inlines
// NEXT_PUBLIC_* into the client bundle when it can see the literal
// name at build time. process.env[name] works on the server and
// leaves the browser with undefined.
export const APP_URL = () =>
  requireValue("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL);
