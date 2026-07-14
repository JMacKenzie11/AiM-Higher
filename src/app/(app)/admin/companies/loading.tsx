import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

export default function AdminCompaniesLoading() {
  return <SkeletonLayeredPage cards={2} showStats={false} />;
}
