import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/** Read at most limit + 1 bytes, even if the opened file grows. */
export function readBounded(path: string, limit: number): Buffer | null {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Expected a regular file.");
    const bytes = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) return bytes.subarray(0, used);
      used += count;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
