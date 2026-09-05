// Test bootstrap. `server-only` throws when imported outside a
// server context, but vitest runs in a Node environment that isn't
// either "server" or "client" from React's point of view. Aliasing
// the module to a no-op in vitest.config.ts is the standard fix;
// this file is a home for any other cross-suite setup we add later.

// Supabase config for the unit suites.
//
// Call sites build an InstanceConfig via getCurrentInstanceConfig()
// and pass it to the client factory. The factories themselves are
// mocked, but the config is still constructed for real on the way in.
// Under vitest there is no request, so nothing was resolved by
// middleware and it takes the cron fallback, which throws by name
// unless one complete set of variables is present.
//
// These are obvious fakes. Nothing in the unit suites opens a socket:
// if one of these values ever reaches a real client, the test was
// wrong before it got here.
process.env.PROD_SUPABASE_URL ||= "https://test.invalid";
process.env.PROD_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.PROD_SUPABASE_SERVICE_KEY ||= "test-service-role-key";

// Still read by the seed scripts, and by any suite that covers them.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

export {};
