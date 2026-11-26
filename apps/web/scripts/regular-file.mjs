import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

/** Runs the operation on the regular file that was actually opened. */
export function withRegularFile(path, flags, work, mode) {
  const fd = openSync(
    path,
    flags | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    mode,
  );
  try {
    const opened = fstatSync(fd, { bigint: true });
    const named = constants.O_NOFOLLOW
      ? opened
      : lstatSync(path, { bigint: true });
    if (
      !opened.isFile() ||
      !named.isFile() ||
      opened.dev !== named.dev ||
      opened.ino !== named.ino
    )
      throw Object.assign(new Error("Expected a regular file."), {
        code: "ENOTFILE",
      });
    return work(fd);
  } finally {
    closeSync(fd);
  }
}

/** Read at most limit + 1 bytes, including if the file grows during the read. */
export function readLimited(fd, limit) {
  const { size } = fstatSync(fd);
  if (size > limit) return null;
  const chunks = [];
  let used = 0;
  while (used <= limit) {
    const capacity =
      chunks.length === 0 ? size + 1 : Math.min(65536, limit + 1 - used);
    const bytes = Buffer.alloc(capacity);
    const count = readSync(fd, bytes, 0, bytes.length, null);
    if (count === 0) return Buffer.concat(chunks, used);
    chunks.push(bytes.subarray(0, count));
    used += count;
  }
  return null;
}
