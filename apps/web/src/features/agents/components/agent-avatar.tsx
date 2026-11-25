import { cva } from "class-variance-authority";
import { toneLooks } from "@/components/app/tones";
import { cn } from "@/lib/utils";
import { avatarTone } from "../presentation";

const avatar = cva(
  "grid shrink-0 place-items-center font-display font-bold select-none",
  {
    variants: {
      // Identity, not status: the soft tone fills, and a fourth colour of
      // its own (violet) so neighbouring agents stay apart.
      tone: {
        mint: toneLooks.success.soft,
        blue: toneLooks.info.soft,
        peach: toneLooks.warning.soft,
        lilac: "bg-violet-soft text-violet",
      },
      size: {
        default: "size-9 rounded-md text-ui",
        sm: "size-6 rounded-md text-micro",
      },
    },
    defaultVariants: { size: "default" },
  },
);

/** The agent's initial on its colour; the same agent keeps the same colour everywhere. */
export function AgentAvatar({
  agentKey,
  size,
  className,
}: {
  agentKey: string;
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <span
      data-slot="agent-avatar"
      className={cn(avatar({ tone: avatarTone(agentKey), size }), className)}
      aria-hidden="true"
    >
      {agentKey.slice(0, 1).toUpperCase()}
    </span>
  );
}
