"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DataEmpty } from "@/components/app/data-table";
import { isBusy } from "@/components/app/live";

const REFRESH_MS = 2000;
const TIMEOUT_MS = 60_000;

export function FirstCheckWaiting() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const deadline = Date.now() + TIMEOUT_MS;
    const interval = window.setInterval(() => {
      if (
        Date.now() < deadline &&
        document.visibilityState === "visible" &&
        !isBusy()
      )
        router.refresh();
    }, REFRESH_MS);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      setTimedOut(true);
    }, TIMEOUT_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [router]);

  return (
    <DataEmpty role="status">
      {timedOut ? (
        <>
          <b>No first check has arrived yet.</b> Run the exact check command in
          a new session from the project folder, then refresh this page.
        </>
      ) : (
        <>
          <b>Waiting for the first check to arrive.</b> This page refreshes
          automatically for up to a minute.
        </>
      )}
    </DataEmpty>
  );
}
