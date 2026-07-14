import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

export default function PersonLoading() {
  return <SkeletonLayeredPage cards={3} showStats={false} />;
}
