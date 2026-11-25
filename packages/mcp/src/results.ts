import type { Me, NodrailApi } from "@nodrail/cli/api";
import { ApiError } from "@nodrail/cli/api";

export type ServerOptions = {
  api: NodrailApi;
  /** The token's GET /me, read once at start. */
  me: Me;
  /** `--allow-publish`: offer publish_rules if the token can publish. */
  allowPublish?: boolean;
  /**
   * `--client-confirms`: publish even when the client can't ask
   * the person through MCP, relying on the client's own per-call prompt.
   */
  clientConfirms?: boolean;
};

export type Result = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const text = (value: unknown): Result => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

/** Every tool answers JSON text, and an API error as a tool error. */
export async function answer(run: () => Promise<unknown>): Promise<Result> {
  try {
    return text(await run());
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      ...text({ error: { code: error.code, request_id: error.requestId } }),
      isError: true,
    };
  }
}

export const refused = (message: string): Result => ({
  ...text(message),
  isError: true,
});
