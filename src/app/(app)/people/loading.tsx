import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

export default function PeopleLoading() {
  return <SkeletonLayeredPage cards={2} showStats={false} />;
}
