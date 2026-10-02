import { SkeletonLayeredPage } from "@/components/skeleton/Skeleton";

// Starting a conversation is usually instant. When it is not, the page
// shows its shape meanwhile.
export default function Loading() {
  return <SkeletonLayeredPage cards={1} />;
}
