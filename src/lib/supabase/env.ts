// Central place to read Supabase config from process.env.
//
// NEXT_PUBLIC_* vars have to be referenced STATICALLY for Next.js
// to inline them into the client bundle at build time. Reading
// them via a dynamic key (process.env[name]) works on the server
// but leaves the client with undefined at runtime — which is how
// the browser Supabase client used to blow up with
// "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL"
// on client components. Each getter now names its env var
// literally so the inliner sees it.
//
// Throwing here surfaces missing env vars at first use instead of
// producing a mystifying 401 from Supabase.

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`
    );
  }
  return value;
}

export const SUPABASE_URL = () =>
  requireValue("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = () =>
  requireValue(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
export const SUPABASE_SERVICE_ROLE_KEY = () =>
  requireValue(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
export const APP_URL = () =>
  requireValue("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL);
