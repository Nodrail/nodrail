"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The item open over a list, kept in the URL as `?<param>=<id>` so it can be
 * linked. Opening one adds a history entry, so Back closes it; moving on to
 * another replaces it, and closing one opened by a link drops the parameter.
 */
export function useUrlSelection(param: string) {
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get(param);
  const pushed = useRef(false);

  useEffect(() => {
    if (!openId) pushed.current = false;
  }, [openId]);

  const urlFor = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set(param, id);
      else next.delete(param);
      const query = next.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [params, param, pathname],
  );

  const open = useCallback(
    (id: string) => {
      window.history.pushState(null, "", urlFor(id));
      pushed.current = true;
    },
    [urlFor],
  );

  const show = useCallback(
    (id: string | null) => {
      if (id) return window.history.replaceState(null, "", urlFor(id));
      if (pushed.current) return window.history.back();
      window.history.replaceState(null, "", urlFor(null));
    },
    [urlFor],
  );

  return { openId, urlFor, open, show };
}
