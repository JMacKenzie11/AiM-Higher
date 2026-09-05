// Test bootstrap. `server-only` throws when imported outside a
// server context, but vitest runs in a Node environment that isn't
// either "server" or "client" from React's point of view. Aliasing
// the module to a no-op in vitest.config.ts is the standard fix;
// this file is a home for any other cross-suite setup we add later.
// Supabase config for the unit suites.
//
// Call sites now build an InstanceConfig via
// getCurrentInstanceConfig() and pass it to the client factory. The
// factories themselves are mocked in these tests, but the config is
// still constructed for real on the way in, and it throws on a
// missing variable by design (see lib/supabase/env.ts) rather than
// producing a mystifying 401 later.
//
// These are obvious fakes. Nothing in the unit suites opens a socket:
// if one of these values ever reaches a real client, the test was
// wrong before it got here.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

export {};
