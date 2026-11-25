import { describe, expect, test } from "vitest";
import { canCreateAccount } from "@/features/auth/signup-policy";

describe("who can create an account", () => {
  test.each([[undefined], [""], ["  "]])("anyone when unset (%j)", (list) => {
    expect(canCreateAccount("a@b.test", list)).toBe(true);
  });

  test("only listed addresses when set, ignoring case and spaces", () => {
    const list = "a@b.test, C@D.test";
    expect(canCreateAccount("a@b.test", list)).toBe(true);
    expect(canCreateAccount(" c@d.TEST ", list)).toBe(true);
    expect(canCreateAccount("x@b.test", list)).toBe(false);
    expect(canCreateAccount("a@b.test.example.org", list)).toBe(false);
  });
});
