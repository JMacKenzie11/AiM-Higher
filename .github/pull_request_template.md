<!--
Delete this comment once the body is written; the headings below are
the standing shape of a report here.

Docs is not optional. A PR touching src/ either changes documentation
or claims an exemption, and CI checks which. See the Documentation
section of CLAUDE.md.
-->

## What changed and why

## Evidence

<!--
Gates are CI, and the run is linked. Probes are the ones this change
added or re-ran, as the roles they are about. Where a probe was red
first, say so — a green that was never red proves less.
-->

- **Gates:**
- **Probes:**
- **Docs:**

<!--
The Docs line is one of:

    Docs: spec §1 (Tenancy & Roles) updated
    Docs: spec §16b updated; help portfolio.md updated
    Docs: deployment.md step 8 updated
    Docs: exempt — pure refactor, no behaviour change

The help page only moves when a USER would do something differently
on that page. RLS, migrations, plans and tooling go to the spec — a
user cannot act on any of it, and a help page that explains the
implementation costs the reader time to discover it was not for them.

If the last form, put the machine-readable marker in the body too, on
its own line, or the Docs check will fail:

    Docs-exempt: pure refactor, no behaviour change
-->

## Migrations

<!--
The migration files, or "none". A fleet migration is applied by Jason,
never inferred from a previous approval.
-->
