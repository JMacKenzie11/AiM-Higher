// Pure calendar arithmetic for quarters.
//
// Split out of quarters/service.ts, which imports "server-only" and
// therefore refuses to load anywhere but a server bundle. That guard
// is right for the service — it opens a Supabase client — and wrong
// for a function that does date maths and touches nothing.
//
// It matters because lib/companies/create-company.ts needs this, and
// that module is imported by the provisioning CLI as well as by the
// app. Behind server-only it took the whole CLI down on import.

export type CalendarQuarter = {
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
};

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calendarQuarterOf(date: Date): CalendarQuarter {
  const year = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1; // 1-4
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0)); // last day of month
  return {
    label: `Q${q} ${year}`,
    startDate: toISODate(start),
    endDate: toISODate(end),
  };
}
