import { LoadingPage, PageHeaderSkeleton } from "@/components/app/skeletons";
import { OverviewBodySkeleton } from "@/features/overview/overview-skeletons";

/**
 * Overview while it loads. The layout above has already checked the address
 * and the page only reads, so this sits above nothing that can reject it (R60).
 */
export default function OverviewLoading() {
  return (
    <>
      <LoadingPage label="overview">
        <PageHeaderSkeleton />
      </LoadingPage>
      <OverviewBodySkeleton />
    </>
  );
}
