import { createApiTokenInput } from "@/contracts/v1/api-tokens";

export function tokenInputFromForm(data: FormData) {
  const raw = {
    name: data.get("name"),
    scopes:
      data.get("tokenType") === "reporting"
        ? ["inventory:write", ...data.getAll("scopes")]
        : data.getAll("scopes"),
    expiresInDays: data.get("expiresInDays") || undefined,
  };
  const parsed = createApiTokenInput.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false as const,
      message:
        field === "name"
          ? "Enter a token name of up to 60 characters."
          : field === "scopes"
            ? "Choose valid access scopes. Inventory reporting must be the only scope on its token."
            : "Choose one of the listed token expiry options.",
    };
  }
  return { ok: true as const, input: parsed.data };
}
