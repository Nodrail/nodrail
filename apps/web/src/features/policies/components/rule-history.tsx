import { Card } from "@/components/app/card";
import type { RuleDetailDto } from "@/contracts/v1/policies";
import { timeAgo } from "@/lib/time";

/** A rule's published versions, newest first, and its revocation. */
export function RuleHistory({
  rule,
}: {
  rule: Pick<RuleDetailDto, "revoked" | "history">;
}) {
  return (
    <Card title="History" description="Published versions are never changed.">
      <ol className="grid gap-3 [&_b]:text-foreground [&_li]:grid [&_li]:gap-0.5 [&_li]:text-ui [&_small]:text-xs [&_small]:text-muted-foreground [&_span]:[overflow-wrap:anywhere] [&_span]:text-body">
        {rule.revoked ? (
          <li>
            <b>Revoked</b>
            <small>
              {rule.revoked.by} · {timeAgo(rule.revoked.at)}
            </small>
          </li>
        ) : null}
        {rule.history.map((item) => (
          <li key={item.revision}>
            <b>Version {item.revision}</b>
            <span>{item.summary}</span>
            <small>
              {item.updatedBy} · {timeAgo(item.updatedAt)}
            </small>
          </li>
        ))}
      </ol>
    </Card>
  );
}
