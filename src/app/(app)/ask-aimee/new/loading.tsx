import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

// Starting a conversation is usually instant. Continuing one from the
// panel takes a few seconds while Aimee writes what was said there
// (lib/aimee/continue.ts), so the page shows its shape meanwhile.
export default function Loading() {
  return <SkeletonLayeredPage cards={1} />;
}
