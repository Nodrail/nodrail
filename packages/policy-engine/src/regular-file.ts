import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";

/** Opens a regular file without following a link at its final component. */
export function openRegular(path: string, flags: number, mode?: number) {
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
      throw new Error("Expected a regular file.");
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
