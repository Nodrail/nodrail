import "server-only";

export const passwordWorkBusy = Symbol("password work busy");

// Next bundles multiple copies of the auth modules. Share the limit across
// them in one process. Each scrypt operation uses about 128 MiB.
const processState = globalThis as typeof globalThis & {
  nodrailPasswordWork?: number;
};

export async function withPasswordWork<T>(
  run: () => Promise<T>,
): Promise<T | typeof passwordWorkBusy> {
  const active = processState.nodrailPasswordWork ?? 0;
  if (active >= 2) return passwordWorkBusy;
  processState.nodrailPasswordWork = active + 1;
  try {
    return await run();
  } finally {
    processState.nodrailPasswordWork!--;
  }
}
