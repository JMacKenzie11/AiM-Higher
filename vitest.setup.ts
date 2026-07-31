// Test bootstrap. `server-only` throws when imported outside a
// server context, but vitest runs in a Node environment that isn't
// either "server" or "client" from React's point of view. Aliasing
// the module to a no-op in vitest.config.ts is the standard fix;
// this file is a home for any other cross-suite setup we add later.
export {};
