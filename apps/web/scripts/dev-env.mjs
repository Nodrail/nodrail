import { appendFileSync, constants, readFileSync } from "node:fs";
import { withRegularFile } from "./regular-file.mjs";

export function seedEnv(path, wanted) {
  const flags = constants.O_RDWR | constants.O_CREAT | constants.O_APPEND;
  withRegularFile(
    path,
    flags,
    (fd) => {
      const current = readFileSync(fd, "utf8");
      const missing = Object.entries(wanted).filter(
        ([key]) => !new RegExp(`^${key}=`, "m").test(current),
      );
      if (!missing.length) return;
      const separator = current && !current.endsWith("\n") ? "\n" : "";
      appendFileSync(
        fd,
        separator + missing.map(([key, value]) => `${key}=${value}\n`).join(""),
      );
    },
    0o600,
  );
}
