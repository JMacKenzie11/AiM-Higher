import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

export default function DashboardLoading() {
  return <SkeletonLayeredPage cards={3} showStats />;
}
