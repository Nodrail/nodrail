import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { readBounded } from "../src/read-bounded.ts";

vi.mock(import("node:fs"), { spy: true });

test("bounded CLI inputs distinguish missing, empty, exact-limit and oversized files", ({
  onTestFinished,
}) => {
  const directory = fs.mkdtempSync(join(tmpdir(), "nodrail-input-"));
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "sample");
  expect(() => readBounded(file, 4)).toThrow(/ENOENT/);
  expect(() => readBounded(directory, 4)).toThrow("regular file");
  fs.writeFileSync(file, "");
  expect(readBounded(file, 4)).toHaveLength(0);
  fs.writeFileSync(file, "éé");
  expect(readBounded(file, 4)?.toString()).toBe("éé");
  expect(readBounded(file, 3)).toBeNull();
});

test("a file growing after its descriptor is checked still hits the byte limit", async ({
  onTestFinished,
}) => {
  const directory = fs.mkdtempSync(join(tmpdir(), "nodrail-growing-input-"));
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "sample");
  fs.writeFileSync(file, "okay");
  const { fstatSync } = await vi.importActual<typeof fs>("node:fs");
  const stat = vi.mocked(fs.fstatSync).mockImplementationOnce((fd) => {
    const before = fstatSync(fd);
    fs.appendFileSync(file, "added");
    return before;
  });
  try {
    expect(readBounded(file, 4)).toBeNull();
    expect(stat).toHaveBeenCalledWith(expect.any(Number));
  } finally {
    stat.mockClear();
  }
});
