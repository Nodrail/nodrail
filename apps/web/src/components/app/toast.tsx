"use client";

import { CircleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/** An error stays until dismissed; anything else leaves on its own. */
export type ToastTone = "info" | "error";

type Show = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Show>(() => undefined);

export const useToast = () => useContext(ToastContext);

/** Messages shown at once; a fourth sends the oldest away. */
const MAX_VISIBLE = 3;

/** Time to read a message: five seconds, and more the longer it is. */
export function toastDuration(message: string) {
  return Math.min(5000 + message.length * 60, 15000);
}

type Toast = { id: number; message: string; tone: ToastTone; open: boolean };

/** Adds a message; the same message again replaces the earlier one. */
function added(list: Toast[], toast: Toast) {
  const rest = list.filter(
    (item) => !(item.open && item.message === toast.message),
  );
  const open = rest.filter((item) => item.open);
  const leaving = new Set(
    open
      .slice(0, Math.max(0, open.length - MAX_VISIBLE + 1))
      .map((item) => item.id),
  );
  return [
    ...rest.map((item) =>
      leaving.has(item.id) ? { ...item, open: false } : item,
    ),
    toast,
  ];
}

function ToastItem({
  toast,
  paused,
  onClose,
  onRemove,
}: {
  toast: Toast;
  paused: boolean;
  onClose: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const { id, message, tone, open } = toast;
  const remaining = useRef(toastDuration(message));

  useEffect(() => {
    if (tone === "error" || !open || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onClose(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [id, tone, open, paused, onClose]);

  return (
    <div
      data-state={open ? "open" : "closed"}
      data-tone={tone}
      className="flex items-start gap-2 rounded-lg bg-ink py-2.75 pr-2 pl-3.5 text-ui leading-[1.4] text-white shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=closed]:fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2"
      onAnimationEnd={() => {
        if (!open) onRemove(id);
      }}
    >
      {tone === "error" ? (
        <CircleAlert
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-highlight"
        />
      ) : null}
      <p className="min-w-0 flex-1">{message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        className={cn(
          "-my-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white",
          focusRing,
        )}
        onClick={() => onClose(id)}
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/**
 * Lives above the page, so a message outlasts the control that caused it, such
 * as Pause being replaced by Resume once the change takes effect. Messages
 * stack rather than replace each other; each stays long enough to read, waits
 * while the pointer or focus is on the messages, and an error stays until
 * dismissed. A message rises in, and fades out before it is removed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const next = useRef(0);

  const show = useCallback<Show>((message, tone = "info") => {
    next.current += 1;
    const toast = { id: next.current, message, tone, open: true };
    setToasts((list) => added(list, toast));
  }, []);
  const close = useCallback((id: number) => {
    setToasts((list) =>
      list.map((item) => (item.id === id ? { ...item, open: false } : item)),
    );
  }, []);
  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      <div
        data-slot="toast"
        className="fixed right-5 bottom-5 z-40 flex max-w-[min(360px,calc(100vw-40px))] flex-col items-end gap-2"
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            paused={hovered || focused}
            onClose={close}
            onRemove={remove}
          />
        ))}
      </div>
    </ToastContext>
  );
}
