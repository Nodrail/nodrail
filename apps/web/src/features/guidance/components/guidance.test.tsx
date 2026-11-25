import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { tourKeys, type GuidanceDto } from "@/contracts/v1/guidance";
import { accountPages, settingsPages } from "@/features/shell/navigation";
import { tourForPath, tourForSection, tours } from "../tours";
import { whatsNew } from "../whats-new";
import { GuidanceProvider, useGuidance } from "./guidance-provider";
import { HelpMenu } from "./help-menu";
import { PageTour, TourButton, keepOpenForTour } from "./page-tour";

/** How many steps the overview tour has. */
const count = tours.overview.steps.length;

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  mark: vi.fn(async () => ({ status: "ok" as const })),
}));

vi.mock("@/features/guidance/actions", () => ({
  markGuidanceAction: mocks.mark,
}));
vi.mock("@/components/analytics/posthog", () => ({ track: mocks.track }));

type AnchorProps = { hidden?: string[]; absent?: string[] };

/** The overview screen's anchors, each laid out unless told otherwise. */
function Anchors({ hidden = [], absent = [] }: AnchorProps) {
  const shown = tours.overview.steps.filter(
    (step) => !absent.includes(step.anchor),
  );
  return (
    <div>
      {shown.map((step) => (
        <button
          key={step.anchor}
          type="button"
          data-tour={step.anchor}
          data-hidden={hidden.includes(step.anchor) ? "" : undefined}
        >
          {step.anchor}
        </button>
      ))}
    </div>
  );
}

function StartButton() {
  const { startTour } = useGuidance();
  return (
    <button type="button" onClick={() => startTour("overview")}>
      Start
    </button>
  );
}

function renderGuidance(children: React.ReactNode, initial: GuidanceDto = {}) {
  return render(
    <GuidanceProvider initial={initial}>{children}</GuidanceProvider>,
  );
}

const tour = () => screen.getByRole("dialog");

/** The overview anchors on the page, some hidden, and the tour started. */
async function startedTour(anchors: AnchorProps = {}) {
  const person = userEvent.setup();
  renderGuidance(
    <>
      <Anchors {...anchors} />
      <StartButton />
    </>,
  );
  await person.click(screen.getByRole("button", { name: "Start" }));
  return person;
}

beforeEach(() => {
  mocks.track.mockReset();
  mocks.mark.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom lays nothing out: anchors without data-hidden take up room.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      const shown = this.isConnected && !this.closest("[data-hidden]");
      return (shown ? [{}] : []) as unknown as DOMRectList;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const shown = !this.closest("[data-hidden]");
      return DOMRect.fromRect({
        x: 10,
        y: 10,
        width: shown ? 80 : 0,
        height: shown ? 20 : 0,
      });
    },
  );
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

describe("a guided tour", () => {
  test("steps forward and back with a counter, and finishes", async () => {
    const person = await startedTour();
    const [first, second] = tours.overview.steps;
    expect(tour()).toHaveAccessibleName(first!.title);
    expect(tour()).toHaveAccessibleDescription(first!.body);
    expect(tour()).toHaveTextContent(`Step 1 of ${count}`);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(mocks.track).toHaveBeenCalledWith("tour_started", {
      tour: "overview",
    });
    expect(mocks.mark).toHaveBeenCalledWith({
      key: "tour:overview",
      value: null,
    });

    await person.click(screen.getByRole("button", { name: "Next" }));
    expect(tour()).toHaveAccessibleName(second!.title);
    expect(tour()).toHaveTextContent(`Step 2 of ${count}`);
    expect(
      document.querySelector(`[data-tour="${second!.anchor}"]`),
    ).toHaveAttribute("data-tour-active");
    await person.click(screen.getByRole("button", { name: "Back" }));
    expect(tour()).toHaveTextContent(`Step 1 of ${count}`);

    for (let step = 1; step < count; step += 1)
      await person.click(screen.getByRole("button", { name: "Next" }));
    expect(tour()).toHaveTextContent(`Step ${count} of ${count}`);
    await person.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.track).toHaveBeenLastCalledWith("tour_completed", {
      tour: "overview",
    });
    expect(document.querySelector("[data-tour-active]")).toBeNull();
  });

  test("Escape ends it, and focus goes back to where it was", async () => {
    const person = await startedTour();
    const start = screen.getByRole("button", { name: "Start" });
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
    await person.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.track).toHaveBeenLastCalledWith("tour_skipped", {
      tour: "overview",
    });
    await waitFor(() => expect(start).toHaveFocus());
  });

  test("Tab stays inside the step", async () => {
    const person = await startedTour();
    await person.click(screen.getByRole("button", { name: "Next" }));
    const skip = screen.getByRole("button", { name: "Skip tour" });
    const back = screen.getByRole("button", { name: "Back" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toHaveFocus();
    await person.tab();
    expect(skip).toHaveFocus();
    await person.tab();
    expect(back).toHaveFocus();
    await person.tab({ shift: true });
    await person.tab({ shift: true });
    expect(next).toHaveFocus();
  });

  test("Skip ends it", async () => {
    const person = await startedTour();
    await person.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.track).toHaveBeenLastCalledWith("tour_skipped", {
      tour: "overview",
    });
  });

  test("a step whose element is missing or hidden sits in the middle", async () => {
    const [first, second] = tours.overview.steps;
    const person = await startedTour({
      absent: [first!.anchor],
      hidden: [second!.anchor],
    });
    expect(tour()).toHaveAttribute("data-placement", "centered");
    await person.click(screen.getByRole("button", { name: "Next" }));
    expect(tour()).toHaveAttribute("data-placement", "centered");
    await person.click(screen.getByRole("button", { name: "Next" }));
    expect(tour()).toHaveAttribute("data-placement", "anchored");
  });
});

describe("a screen's own tour", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  const settle = () => act(() => vi.advanceTimersByTimeAsync(500));

  /** The overview opened again with this guidance: no tour opens by itself. */
  async function staysClosed(
    rerender: (ui: React.ReactNode) => void,
    initial: GuidanceDto,
  ) {
    rerender(
      <GuidanceProvider initial={initial}>
        <Anchors />
        <PageTour tour="overview" ready />
      </GuidanceProvider>,
    );
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.useRealTimers();
  }

  test("opens by itself once, when the screen has something to show", async () => {
    const { rerender } = renderGuidance(
      <>
        <Anchors />
        <PageTour tour="overview" ready />
      </>,
    );
    await settle();
    expect(tour()).toBeVisible();
    await act(async () =>
      screen.getByRole("button", { name: "Skip tour" }).click(),
    );
    await staysClosed(rerender, {});
  });

  test("only Overview opens its own by itself", async () => {
    renderGuidance(
      <>
        <Anchors />
        <PageTour tour="policies" ready />
        <PageTour tour="event" ready />
      </>,
    );
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.useRealTimers();
  });

  test("Don't show tours, on the first card, keeps every tour from opening by itself", async () => {
    const { rerender } = renderGuidance(
      <>
        <Anchors />
        <PageTour tour="overview" ready />
      </>,
    );
    await settle();
    await act(async () =>
      screen.getByRole("button", { name: "Don't show tours" }).click(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.mark).toHaveBeenCalledWith({
      key: "tours_off",
      value: null,
    });
    await staysClosed(rerender, { tours_off: null });
  });

  test("never on an empty screen, nor once seen", async () => {
    renderGuidance(<PageTour tour="overview" ready={false} />);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    renderGuidance(<PageTour tour="policies" ready />, {
      "tour:policies": null,
    });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.mark).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("the Help menu", () => {
  const renderHelp = (initial: GuidanceDto, path = "/development/overview") =>
    renderGuidance(
      <>
        <Anchors />
        <HelpMenu
          base="/app/acme/development"
          path={path}
          triggerClassName=""
        />
      </>,
      initial,
    );

  test("replays this page's tour", async () => {
    const person = userEvent.setup();
    renderHelp({ "tour:overview": null });
    await person.click(screen.getByLabelText(/^Help/));
    await person.click(
      screen.getByRole("button", { name: "Take the tour of this page" }),
    );
    expect(tour()).toHaveTextContent(`Step 1 of ${count}`);
  });

  test("offers no tour on a page without one", async () => {
    const person = userEvent.setup();
    renderHelp({}, "/development");
    await person.click(screen.getByLabelText(/^Help/));
    expect(
      screen.queryByRole("button", { name: "Take the tour of this page" }),
    ).toBeNull();
  });

  test("shows a dot until What's new is opened", async () => {
    const person = userEvent.setup();
    renderHelp({});
    expect(screen.getByLabelText("Help, with something new")).toBeVisible();
    await person.click(screen.getByLabelText(/^Help/));
    await person.click(screen.getByRole("button", { name: /What's new/ }));
    expect(mocks.track).toHaveBeenCalledWith("whats_new_opened");
    expect(mocks.mark).toHaveBeenCalledWith({
      key: "whats_new",
      value: whatsNew[0]!.id,
    });
    expect(screen.getByLabelText("Help")).toBeVisible();
    expect(document.querySelector("[data-slot=unread-dot]")).toBeNull();
    expect(
      document.querySelectorAll("[data-slot=whats-new-entry]"),
    ).toHaveLength(whatsNew.length);
  });

  test("shows no dot once the newest entry was read", () => {
    renderHelp({ whats_new: whatsNew[0]!.id });
    expect(screen.getByLabelText("Help")).toBeVisible();
  });

  test("replays the tour of a settings page, outside any environment", async () => {
    const person = userEvent.setup();
    renderHelp({ "tour:settings": null }, "/settings/members");
    await person.click(screen.getByLabelText(/^Help/));
    await person.click(
      screen.getByRole("button", { name: "Take the tour of this page" }),
    );
    expect(tour()).toHaveTextContent("Workspace settings · Step 1 of 4");
  });
});

describe("tourForPath", () => {
  test.each([
    ["/development/overview", "overview"],
    ["/production/policies/yaml", "policies-yaml"],
    ["/development/activity", "activity"],
    ["/development/insights/", "insights"],
    ["/settings/general", "settings"],
    ["/settings/billing", "settings"],
    ["/account/tokens", "account"],
    ["/development/agents/connect", "connect"],
    ["/development/policies/import", "import"],
    ["/development", null],
    ["", null],
  ])("%s has the %s tour", (path, expected) => {
    expect(tourForPath(path)).toBe(expected);
  });

  test("settings and account tours point at their side menus", () => {
    const anchors = new Set<string>([
      "settings-nav",
      "account-nav",
      ...[...settingsPages, ...accountPages].map((page) => page.tour),
    ]);
    for (const key of ["settings", "account"] as const)
      for (const step of tours[key].steps)
        expect(anchors.has(step.anchor), step.anchor).toBe(true);
  });
});

describe("the tours", () => {
  test("every tour has 3 to 5 steps, each on its own anchor", () => {
    for (const key of tourKeys) {
      const { steps } = tours[key];
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps.length).toBeLessThanOrEqual(5);
      expect(new Set(steps.map((step) => step.anchor)).size).toBe(steps.length);
    }
  });

  test("pages map to their tours", () => {
    expect(tourForSection("/overview")).toBe("overview");
    expect(tourForSection("/activity/runs/r1")).toBe("run");
    expect(tourForSection("/approvals/")).toBeNull();
  });

  test("a dialog's tour button replays its tour", async () => {
    const person = userEvent.setup();
    renderGuidance(
      <TourButton tour="event" label="Take the tour of this event" />,
      { "tour:event": null },
    );
    await person.click(
      screen.getByRole("button", { name: "Take the tour of this event" }),
    );
    expect(tour()).toHaveTextContent(`Step 1 of ${tours.event.steps.length}`);
  });

  test("a click on the tour's card does not close the dialog under it", () => {
    const card = document.createElement("div");
    card.dataset.slot = "tour";
    const inside = card.appendChild(document.createElement("button"));
    const event = { target: inside, preventDefault: vi.fn() };
    keepOpenForTour(event);
    expect(event.preventDefault).toHaveBeenCalled();
    const elsewhere = { target: document.body, preventDefault: vi.fn() };
    keepOpenForTour(elsewhere);
    expect(elsewhere.preventDefault).not.toHaveBeenCalled();
  });
});
