// A no-op stand-in for the `server-only` package.
//
// That package exists to make the Next bundler fail the build if a
// server module is pulled into a client bundle. It does that by
// throwing on import outside a server bundle — which is exactly what
// happens when the provisioning CLI imports app code that carries the
// guard, even though a CLI is about as server-side as code gets.
//
// So it is aliased away here, the same way vitest.config.ts aliases it
// for the unit suite and for the same reason. This changes nothing
// about the app build: the alias lives in scripts/tsconfig.json, which
// nothing but scripts/ uses.
export {};
