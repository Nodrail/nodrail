import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { toneLooks, tones } from "@/components/app/tones";
import {
  effectTones,
  entryLooks,
  legendLooks,
} from "@/features/policies/entry-looks";

const src = resolve(__dirname, "../src");
/** Shared with the website (apps/site). */
const shared = resolve(__dirname, "../../../packages/web-shared/src");
const css = readFileSync(join(shared, "styles/tokens.css"), "utf8");

/** The custom properties a block sets, by its selector. */
function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2]!.trim(),
    ]),
  );
}

const root = Object.assign(
  {},
  ...css
    .split(":root {")
    .slice(1)
    .map((part) =>
      Object.fromEntries(
        [
          ...part
            .slice(0, part.indexOf("}"))
            .matchAll(/(--[\w-]+):\s*([^;]+);/g),
        ].map((m) => [m[1], m[2]!.trim()]),
      ),
    ),
) as Record<string, string>;
const product = { ...root, ...block('[data-surface="product"]') };

/** A colour value, following var() to a hex colour. */
function hex(value: string, scope: Record<string, string>): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref) return hex(scope[ref[1]!] ?? "", scope);
  if (value === "white") return "#ffffff";
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Not a colour: ${value}`);
  return value;
}

function luminance(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(color.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string, scope: Record<string, string>) {
  const [x, y] = [luminance(hex(a, scope)), luminance(hex(b, scope))].sort(
    (p, q) => q - p,
  );
  return (x! + 0.05) / (y! + 0.05);
}

describe("design tokens", () => {
  test.each([
    ["the site", root],
    ["the product", product],
  ])("control borders and the focus ring read at 3:1 in %s", (_, scope) => {
    for (const surface of ["white", "var(--background)"]) {
      expect(
        contrast("var(--input-strong)", surface, scope),
      ).toBeGreaterThanOrEqual(3);
      expect(contrast("var(--ring)", surface, scope)).toBeGreaterThanOrEqual(3);
    }
  });

  test.each(tones)(
    "the %s tone's text reads at 4.5:1 on its soft fill",
    (tone) => {
      const { text, soft } = toneLooks[tone].vars;
      expect(contrast(text, soft, product)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each(legendLooks.map((look) => [look.key, look] as const))(
    "the YAML editor's %s badge reads at 4.5:1",
    (_, look) => {
      expect(contrast(look.text, look.soft, product)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

describe("entry looks", () => {
  test("a rule's badge and the editor share one tone per effect", () => {
    expect(entryLooks.allow).toMatchObject({
      label: "Allow",
      ...toneLooks[effectTones.allow].vars,
    });
    expect(Object.keys(effectTones)).toEqual(["allow", "deny"]);
    expect(entryLooks.deny.fill).toBe(toneLooks.danger.vars.fill);
  });

  test("gates and budgets have tokens of their own, with no fallbacks", () => {
    expect(entryLooks.gate).toMatchObject({
      label: "Gate",
      fill: "var(--gate)",
    });
    expect(entryLooks.budget).toMatchObject({
      label: "Budget",
      fill: "var(--budget)",
    });
    for (const look of legendLooks)
      for (const value of [look.fill, look.text, look.soft])
        expect(value).toMatch(/^var\(--[\w-]+\)$/);
  });
});

/** Every product source file (the website is apps/site). */
function productFiles(dir = src): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productFiles(path);
    return /\.(tsx?|css)$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

describe("one design system", () => {
  const files = [...productFiles(), ...productFiles(shared)].map((path) => [
    path,
    readFileSync(path, "utf8"),
  ]);

  test("the product is light only: no dark: variants", () => {
    expect(
      files.filter(([, text]) => /\bdark:/.test(text!)).map(([path]) => path),
    ).toEqual([]);
  });

  test("every focus ring is the solid one", () => {
    expect(
      files
        .filter(([, text]) => /ring-ring\/50|ring-\[3px\]/.test(text!))
        .map(([path]) => path),
    ).toEqual([]);
  });
});
