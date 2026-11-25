"use client";

import {
  useSyncExternalStore,
  useTransition,
  type ComponentProps,
} from "react";

const subscribe = () => () => {};

/**
 * A form that submits to a server action and keeps what was typed. React clears
 * uncontrolled fields after a plain form action, which loses input on an error.
 * The form becomes interactive when the client submit handler is ready.
 */
export function ActionForm({
  action,
  ...props
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (data: FormData) => void;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [, startTransition] = useTransition();
  return (
    <form
      {...props}
      method="post"
      inert={!ready}
      onSubmit={(event) => {
        event.preventDefault();
        const { submitter } = event.nativeEvent as SubmitEvent;
        // Includes the pressed button, so one form can offer several choices.
        const data = new FormData(event.currentTarget, submitter);
        startTransition(() => action(data));
      }}
    />
  );
}
