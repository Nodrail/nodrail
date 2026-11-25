import { describe, expect, test } from "vitest";
import {
  readWorkspace,
  withUser,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import { UserGuidance } from "@/server/db/guidance-entities";
import {
  getFirstSteps,
  markGuidance,
  readGuidance,
} from "@/server/modules/guidance";
import { createRule } from "@/server/modules/policies";
import { ENV } from "./runs-world";
import {
  addMember,
  admin,
  createAgent,
  createPerson,
  createWorkspace,
  ruleBody,
  useDatabase,
} from "./world";

useDatabase();

const mark = (person: HumanPrincipal, key: string, value?: string) =>
  withUser(person, (context) => markGuidance(context, { key, value }));

const read = (person: HumanPrincipal) => withUser(person, readGuidance);

const rowsOf = (person: HumanPrincipal) =>
  admin.getRepository(UserGuidance).findBy({ userId: person.userId });

describe("what a person has seen", () => {
  test("marking a tour seen twice keeps one row and its first time", async () => {
    const person = await createPerson("Ana");
    await mark(person, "tour:overview");
    const [first] = await rowsOf(person);
    await mark(person, "tour:overview");
    const rows = await rowsOf(person);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seenAt).toEqual(first?.seenAt);
    expect(await read(person)).toEqual({ "tour:overview": null });
  });

  test("the last entry read moves on", async () => {
    const person = await createPerson("Ana");
    await mark(person, "whats_new", "insights");
    await mark(person, "whats_new", "short-urls");
    expect(await read(person)).toEqual({ whats_new: "short-urls" });
    expect(await rowsOf(person)).toHaveLength(1);
  });

  test("asking for no tours is kept, as a key of its own", async () => {
    const person = await createPerson("Ana");
    await mark(person, "tours_off");
    expect(await read(person)).toEqual({ tours_off: null });
  });

  test("only known keys can be recorded", async () => {
    const person = await createPerson("Ana");
    for (const key of ["tour:billing", "anything", "checklist:not-a-uuid"])
      await expect(mark(person, key)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    await expect(mark(person, "whats_new", "Not An Id")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  test("screens read it as the person, in any workspace", async () => {
    const w = await createWorkspace();
    await mark(w.owner, "tour:activity");
    expect(await readWorkspace(w.owner, w.id, readGuidance)).toEqual({
      "tour:activity": null,
    });
  });
});

describe("one person's guidance is theirs alone", () => {
  test("nobody reads another person's rows", async () => {
    const ana = await createPerson("Ana");
    const ben = await createPerson("Ben");
    await mark(ana, "tour:insights");
    await mark(ben, "tour:policies");
    expect(await read(ana)).toEqual({ "tour:insights": null });
    const all = await withUser(ana, ({ manager }) =>
      manager.query("SELECT user_id FROM nodrail.user_guidance"),
    );
    expect(all).toEqual([{ user_id: ana.userId }]);
  });

  test("nobody writes or changes another person's rows", async () => {
    const ana = await createPerson("Ana");
    const ben = await createPerson("Ben");
    await mark(ben, "whats_new", "insights");
    await expect(
      withUser(ana, ({ manager }) =>
        manager.query(
          `INSERT INTO nodrail.user_guidance (user_id, key) VALUES ($1, 'tour:overview')`,
          [ben.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const changed = await withUser(ana, ({ manager }) =>
      manager.query(
        `UPDATE nodrail.user_guidance SET value = 'short-urls'
         WHERE user_id = $1 RETURNING key`,
        [ben.userId],
      ),
    );
    expect(changed).toEqual([[], 0]);
    await expect(
      withUser(ana, ({ manager }) =>
        manager.query(`DELETE FROM nodrail.user_guidance WHERE user_id = $1`, [
          ben.userId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(await read(ben)).toEqual({ whats_new: "insights" });
  });
});

describe("a workspace's first steps", () => {
  const steps = (w: Awaited<ReturnType<typeof createWorkspace>>) =>
    readWorkspace(w.owner, w.id, (context) => getFirstSteps(context, ENV));

  test("start undone and tick themselves from what is there", async () => {
    const w = await createWorkspace();
    expect(await steps(w)).toEqual({
      agent: false,
      rule: false,
      decision: false,
      teammate: false,
    });

    // The world's agent comes with a call the rules decided.
    await createAgent(w, "support");
    expect(await steps(w)).toMatchObject({ agent: true, decision: true });

    await withWorkspace(w.owner, w.id, (context) =>
      createRule(context, ENV, ruleBody({ operationKey: "issues.list" })),
    );
    expect(await steps(w)).toEqual({
      agent: true,
      rule: true,
      decision: true,
      teammate: false,
    });

    await addMember(w, "viewer");
    expect(await steps(w)).toMatchObject({ teammate: true });
  });

  test("count only this workspace", async () => {
    const w = await createWorkspace();
    const other = await createWorkspace();
    await createAgent(other, "support");
    await addMember(other, "viewer");
    expect(await steps(w)).toMatchObject({ agent: false, teammate: false });
  });
});
