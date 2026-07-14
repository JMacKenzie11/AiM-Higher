import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

export default function CompanyDetailLoading() {
  return <SkeletonLayeredPage cards={3} showStats={false} />;
}
