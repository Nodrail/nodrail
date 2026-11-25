"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { track } from "@/components/analytics/posthog";
import { Panel } from "@/components/app/card";
import { cardTitle } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  checklistKey,
  firstStepKeys,
  type FirstStepKey,
  type FirstStepsDto,
} from "@/contracts/v1/guidance";
import { useGuidance } from "@/features/guidance/components/guidance-provider";
import { cn } from "@/lib/utils";

type StepCopy = {
  title: string;
  todo: string;
  done: string;
  /** Below the environment, or below the workspace for its own pages. */
  link: { label: string; path: string; inWorkspace?: true };
};

const copy: Record<FirstStepKey, StepCopy> = {
  agent: {
    title: "Connect an agent",
    todo: "Give your agent its own identity and a credential for this control plane. Your provider keys stay with your team.",
    done: "An agent is connected.",
    link: { label: "Connect an agent", path: "/agents/connect" },
  },
  rule: {
    title: "Declare, plan and apply",
    todo: "Declare the policy in nodrail.yaml with a connect: block that points here. Run nodrail plan to see the changes, then nodrail apply to publish the policy and install the hook on the host.",
    done: "A policy is live in this environment.",
    link: { label: "Open Policies", path: "/policies" },
  },
  decision: {
    title: "Run and watch",
    todo: "Run your agent. The hook allows or denies each action, and Activity shows every decision and run.",
    done: "The policy has decided an action.",
    link: { label: "Open Activity", path: "/activity" },
  },
  teammate: {
    title: "Invite a teammate",
    todo: "Add someone to look after the rules and agents with you.",
    done: "Someone else has joined or been invited.",
    link: {
      label: "Invite a teammate",
      path: "/settings/members",
      inWorkspace: true,
    },
  },
};

/** Until an integration checks in, a connected agent still has a step to go. */
const notCheckedIn =
  "Connected. Set its credential where the host runs: Overview fills in on its first check-in.";

/**
 * Reports each step the first time this person sees it done, once per
 * workspace, whether or not the list is still showing.
 */
export function FirstStepsTracker({
  workspaceId,
  steps,
}: {
  workspaceId: string;
  steps: FirstStepsDto;
}) {
  const { seen, mark } = useGuidance();
  useEffect(() => {
    for (const item of firstStepKeys) {
      const key = checklistKey(workspaceId, item);
      if (!steps[item] || seen(key)) continue;
      track("checklist_item_done", { item });
      void mark(key);
    }
  }, [workspaceId, steps, seen, mark]);
  return null;
}

/** Where a step leads: a page of the environment, or of the workspace. */
function stepLink({ link }: StepCopy, base: string, workspaceBase: string) {
  return {
    label: link.label,
    href: `${link.inWorkspace ? workspaceBase : base}${link.path}`,
  };
}

function Step({
  item,
  done,
  current,
  base,
  workspaceBase,
  checkedIn,
}: {
  item: FirstStepKey;
  done: boolean;
  current: boolean;
  base: string;
  workspaceBase: string;
  checkedIn: boolean;
}) {
  const text = copy[item];
  const waiting = item === "agent" && done && !checkedIn;
  const link = waiting
    ? { label: "Open agents", href: `${base}/agents` }
    : stepLink(text, base, workspaceBase);
  return (
    <li
      data-slot="first-step"
      data-step={item}
      data-done={done ? "" : undefined}
      aria-current={current ? "step" : undefined}
      className="flex items-start gap-3.5 border-t pt-3.5 first:border-t-0 first:pt-0"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold [&_svg]:size-4",
          done
            ? "bg-success-soft text-success"
            : "bg-muted text-muted-foreground",
        )}
      >
        {done ? (
          <Check className="animate-pop" />
        ) : (
          firstStepKeys.indexOf(item) + 1
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-0.5 text-sm font-semibold text-foreground">
          <span className="sr-only">{done ? "Done: " : "To do: "}</span>
          {text.title}
        </h3>
        <p className="text-ui leading-normal text-muted-foreground">
          {waiting ? notCheckedIn : done ? text.done : text.todo}
        </p>
        {!done || waiting ? (
          <Button
            asChild
            size="sm"
            variant={current ? "default" : "outline"}
            className="mt-2.5"
          >
            <Link href={link.href}>{link.label}</Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Sets the list aside for good, then shows the Overview without it. */
function useSetAside(key: string) {
  const { mark } = useGuidance();
  const router = useRouter();
  const [hiding, startHiding] = useTransition();
  const hide = () =>
    startHiding(async () => {
      await mark(key);
      router.refresh();
    });
  return [hiding, hide] as const;
}

/** "First steps · 1 of 4 done", with the way to set the list aside. */
function StepsHeader({
  done,
  hiding,
  hide,
  disclosure,
}: {
  done: number;
  hiding: boolean;
  hide: () => void;
  /** The control that shows the steps while the list is folded away. */
  disclosure?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="first-steps-title" className={cn(cardTitle, "mb-1")}>
          First steps
        </h2>
        <p
          data-slot="first-steps-progress"
          className="text-xs text-muted-foreground"
        >
          {done} of {firstStepKeys.length} done
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {disclosure}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={hiding}
          onClick={hide}
        >
          Hide these steps
        </Button>
      </div>
    </div>
  );
}

/** Shows or folds the steps when they start folded. */
function useDisclosure(folded: boolean) {
  const [open, setOpen] = useState(!folded);
  const control = folded ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-controls="first-steps-list"
      onClick={() => setOpen((value) => !value)}
    >
      {open ? "Fold steps" : "Show steps"}
    </Button>
  ) : undefined;
  return [open, control] as const;
}

/**
 * A new workspace's first steps. Each ticks itself from what is really there,
 * so none can be ticked by hand; the person can set the list aside for good
 * at any point, setting up at their own pace. `base` is the environment's path; `workspaceBase`
 * the workspace's, for its own pages such as Members. While requests wait the
 * list starts `folded` to its progress line, so what waits comes first.
 */
export function FirstSteps({
  base,
  workspaceBase,
  workspaceId,
  steps,
  checkedIn,
  folded = false,
}: {
  base: string;
  workspaceBase: string;
  workspaceId: string;
  steps: FirstStepsDto;
  checkedIn: boolean;
  folded?: boolean;
}) {
  const { seen } = useGuidance();
  const key = checklistKey(workspaceId);
  const [hiding, hide] = useSetAside(key);
  const [open, disclosure] = useDisclosure(folded);
  if (seen(key)) return null;

  const done = firstStepKeys.filter((item) => steps[item]).length;
  const current = firstStepKeys.find((item) => !steps[item]);

  return (
    <section
      data-slot="first-steps"
      data-tour="overview-first-steps"
      data-folded={open ? undefined : ""}
      aria-labelledby="first-steps-title"
      className={folded ? undefined : "mb-4"}
    >
      <Panel>
        <StepsHeader
          done={done}
          hiding={hiding}
          hide={hide}
          disclosure={disclosure}
        />
        <Progress
          value={(done / firstStepKeys.length) * 100}
          aria-label="First steps done"
          className={cn(
            "mt-3 h-1.5 bg-muted *:data-[slot=progress-indicator]:bg-forest *:data-[slot=progress-indicator]:duration-500",
            open && "mb-4",
          )}
        />
        <ol
          id="first-steps-list"
          hidden={!open}
          className="stagger grid gap-3.5"
        >
          {firstStepKeys.map((item) => (
            <Step
              key={item}
              item={item}
              done={steps[item]}
              current={item === current}
              base={base}
              workspaceBase={workspaceBase}
              checkedIn={checkedIn}
            />
          ))}
        </ol>
      </Panel>
    </section>
  );
}
