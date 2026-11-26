import {
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { seedEnv } from "../scripts/dev-env.mjs";
import { readLimited, withRegularFile } from "../scripts/regular-file.mjs";

test("dev env setup appends only missing keys and keeps an unterminated value", ({
  onTestFinished,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "nodrail-dev-env-"));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, ".env.local");
  writeFileSync(file, "KEEP=custom");
  const settings = { KEEP: "default", ADD: "new" };
  seedEnv(file, settings);
  seedEnv(file, settings);
  expect(readFileSync(file, "utf8")).toBe("KEEP=custom\nADD=new\n");
});

test.skipIf(process.platform === "win32")(
  "public-file reads and dev env updates reject symlinks",
  ({ onTestFinished }) => {
    const folder = mkdtempSync(join(tmpdir(), "nodrail-public-file-"));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const target = join(folder, "existing");
    const link = join(folder, ".env.local");
    writeFileSync(target, "KEEP=custom\n");
    symlinkSync(target, link);
    expect(() =>
      withRegularFile(link, constants.O_RDONLY, (fd: number) =>
        readFileSync(fd),
      ),
    ).toThrow();
    expect(() => seedEnv(link, { ADD: "new" })).toThrow();
    expect(readFileSync(target, "utf8")).toBe("KEEP=custom\n");
  },
);

test("secret scanning reads the exact byte limit and skips oversized files", ({
  onTestFinished,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "nodrail-secret-scan-"));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "file");
  const read = (limit: number) =>
    withRegularFile(path, constants.O_RDONLY, (fd: number) =>
      readLimited(fd, limit),
    );
  writeFileSync(path, "é");
  expect(read(2)).toEqual(Buffer.from("é"));
  expect(read(1)).toBeNull();
});
