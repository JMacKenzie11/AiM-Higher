import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

// Shown the moment the link is clicked, while the page's data is read
// (2026-11-10 performance audit). Without it the previous page stays
// on screen until this one is ready, and a slow load reads as a click
// that did nothing. Covers lessons and trainings too.
export default function ClassroomLoading() {
  return <SkeletonLayeredPage cards={2} showStats={false} />;
}
