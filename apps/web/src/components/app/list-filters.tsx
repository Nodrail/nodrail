"use client";

import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./form-field";

/** A search box with an icon; its label is for screen readers only. */
export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 min-w-55 flex-1 items-center gap-1.75 rounded-md border border-input-strong px-2.25 text-muted-foreground transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background phone:h-10 phone:min-w-full">
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        className="w-full min-w-0 border-0 bg-transparent text-sm text-body outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/** A compact dropdown whose label is for screen readers only. */
export function FilterSelect<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <NativeSelect
        id={id}
        className="w-auto max-w-47.5"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * The track for a segmented control. Its buttons (`aria-pressed`) or links
 * (`aria-current="page"`) are styled here; the chosen one is a raised chip.
 */
export function Segmented({
  as: Element = "div",
  className,
  ...props
}: ComponentProps<"div"> & { as?: "div" | "nav" }) {
  return (
    <Element
      data-slot="segmented"
      className={cn(
        "flex gap-0.5 rounded-md bg-muted p-0.75",
        "*:cursor-pointer *:rounded-sm *:px-2.5 *:py-1.5 *:text-ui *:text-muted-foreground *:no-underline *:transition-[color,background-color,box-shadow] *:duration-150 *:hover:text-foreground",
        "*:aria-[current=page]:bg-card *:aria-[current=page]:font-semibold *:aria-[current=page]:text-foreground *:aria-[current=page]:shadow-xs *:aria-pressed:bg-card *:aria-pressed:font-semibold *:aria-pressed:text-foreground *:aria-pressed:shadow-xs",
        "*:outline-none *:focus-visible:ring-2 *:focus-visible:ring-ring *:focus-visible:ring-offset-2 *:focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    />
  );
}

/** Mutually exclusive filter buttons. */
export function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Segmented role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </Segmented>
  );
}
