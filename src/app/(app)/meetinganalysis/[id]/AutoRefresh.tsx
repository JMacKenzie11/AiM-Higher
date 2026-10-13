"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// While the analysis runs, look again every 15 seconds, so the page
// turns into the report without anybody pressing refresh.
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
