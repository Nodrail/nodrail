import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useFormEntry, useImpact } from "./use-impact";

const previewImpactAction = vi.fn();
vi.mock("./actions", () => ({
  previewImpactAction: (...args: unknown[]) =>
    previewImpactAction(...args) as unknown,
}));

const fromForm = (data: FormData) => ({ name: data.get("name") });

/** A form with the preview, whose save never answers unless told to. */
function Form({
  pending,
  submit,
}: {
  pending: boolean;
  submit: (data: FormData) => void;
}) {
  const entry = useFormEntry(fromForm, pending);
  const impact = useImpact(
    { workspace: "w", environment: "development" },
    { kind: "rule", id: null },
    entry,
  );
  const action = entry.submitWith(submit);
  return (
    <form
      ref={entry.form}
      onChange={entry.read}
      onSubmit={(event) => {
        event.preventDefault();
        action(new FormData(event.currentTarget));
      }}
    >
      <input name="name" aria-label="Name" defaultValue="" />
      <p>{impact.status}</p>
    </form>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  previewImpactAction.mockReset();
  previewImpactAction.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
});

const type = (form: HTMLElement, value: string) => {
  const input = form.querySelector("input")!;
  fireEvent.change(input, { target: { value } });
};

describe("the publish preview", () => {
  test("asks a moment after the form stops changing", () => {
    const { container } = render(<Form pending={false} submit={vi.fn()} />);
    previewImpactAction.mockClear();
    type(container, "Deploys");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(previewImpactAction).toHaveBeenCalledTimes(1);
  });

  test("asks nothing once the form submits", () => {
    const submit = vi.fn();
    const { container, rerender } = render(
      <Form pending={false} submit={submit} />,
    );
    previewImpactAction.mockClear();
    type(container, "Deploys");
    // Published before the preview's delay is over.
    fireEvent.submit(container.querySelector("form")!);
    expect(submit).toHaveBeenCalledTimes(1);
    rerender(<Form pending submit={submit} />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(previewImpactAction).not.toHaveBeenCalled();
  });

  test("asks again after a save that failed", () => {
    const submit = vi.fn();
    const { container, rerender } = render(
      <Form pending={false} submit={submit} />,
    );
    fireEvent.submit(container.querySelector("form")!);
    rerender(<Form pending submit={submit} />);
    rerender(<Form pending={false} submit={submit} />);
    previewImpactAction.mockClear();
    type(container, "Fixed name");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(previewImpactAction).toHaveBeenCalledTimes(1);
  });
});
