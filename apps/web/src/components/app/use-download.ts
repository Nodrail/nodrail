"use client";

import { useCallback } from "react";
import { useToast } from "./toast";

const attachmentName = /filename="([^"]+)"/;

/**
 * Downloads a file the server sends as an attachment. Fetched rather than
 * followed, so a failure is reported, not saved; resolves to the response
 * (for its headers), or null after saying what failed.
 */
export function useDownload() {
  const toast = useToast();
  return useCallback(
    async (href: string, failure: string) => {
      const response = await fetch(href).catch(() => null);
      const name = response?.headers
        .get("content-disposition")
        ?.match(attachmentName)?.[1];
      // Without the header it is the sign-in page, not the file.
      if (!response?.ok || !name) {
        toast(failure, "error");
        return null;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      return response;
    },
    [toast],
  );
}
