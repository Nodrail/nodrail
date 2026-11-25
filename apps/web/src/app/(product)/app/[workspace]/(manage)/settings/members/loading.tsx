import { DataTableSkeleton } from "@/components/app/skeleton-lists";
import {
  LineSkeleton,
  LoadingPage,
  PageHeaderSkeleton,
} from "@/components/app/skeletons";

/** Members while they load: the counts over the members table. */
export default function MembersLoading() {
  return (
    <LoadingPage label="members">
      <PageHeaderSkeleton actions={1} />
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
        <LineSkeleton className="w-40" />
        <LineSkeleton className="w-28 text-xs" />
      </div>
      <DataTableSkeleton columns={3} rows={4} actions={1} />
    </LoadingPage>
  );
}
