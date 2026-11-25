import { DataTableSkeleton } from "@/components/app/skeleton-lists";
import {
  ButtonSkeleton,
  LineSkeleton,
  LoadingPage,
  PageHeaderSkeleton,
} from "@/components/app/skeletons";

/**
 * Policies while they load: the tabs and count line over the filtered rule table.
 *
 * In (index) so it covers this list alone: a placeholder above a rule, new rule or
 * import page would start the response before it could answer 404.
 */
export default function PoliciesLoading() {
  return (
    <LoadingPage label="policies">
      <PageHeaderSkeleton actions={3} />
      <ButtonSkeleton className="mb-4 h-9 w-64 rounded-md" />
      <LineSkeleton className="mb-[13px] w-72" />
      <DataTableSkeleton columns={4} rows={6} toolbar={2} actions={2} />
      <LineSkeleton className="mt-2.5 w-80 text-xs" />
    </LoadingPage>
  );
}
