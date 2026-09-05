// The connection details for one customer instance.
//
// An instance is a subdomain plus the database behind it. Every
// instance has its own Supabase project, so resolving a request to an
// instance is the same thing as choosing which database to talk to.
// There is deliberately no "default" instance: a request that does not
// resolve gets nothing, rather than quietly landing in someone else's
// data.

export type InstanceStatus = "active" | "suspended";

export type InstanceConfig = {
  // The first label of the hostname, e.g. "acme" in acme.example.com.
  subdomain: string;
  // Human-readable name for the instance, shown in admin surfaces.
  displayName: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Service-role key. Server-side only, never sent to a browser.
  supabaseServiceKey: string;
  // Suspended instances still resolve. What suspension means (a
  // billing screen, a read-only mode, a hard block) is the caller's
  // decision, not this library's.
  status: InstanceStatus;
};
