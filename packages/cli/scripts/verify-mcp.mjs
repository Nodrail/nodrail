// `nodrail mcp` from the installed package: starts the server over stdio
// against a tiny fake Nodrail and lists its tools.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";

const me = {
  token: {
    id: "t",
    name: "pack",
    prefix: "ndp_0",
    scopes: ["read", "rules:write"],
  },
  person: { name: "Pack" },
  workspace: { id: "w", name: "Pack", slug: "pack" },
  role: "admin",
  can: { read: true, rules_write: true },
  environments: [],
};

function fakeNodrail() {
  const server = createServer((request, response) => {
    const ok = request.headers.authorization === "Bearer ndp_pack";
    response.writeHead(ok && request.url === "/api/v1/me" ? 200 : 401, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify(ok ? me : { error: { code: "UNAUTHENTICATED" } }),
    );
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done(server)),
  );
}

/** Sends JSON-RPC lines and answers each response by id. */
function rpc(child) {
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let next = 0;
  return {
    request(method, params) {
      next += 1;
      const id = next;
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      return new Promise((done, failed) => {
        waiting.set(id, done);
        setTimeout(
          () => failed(new Error(`${method} timed out`)),
          15_000,
        ).unref();
      });
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
  };
}

async function listTools(folder, url, flags) {
  // This Node and no shell: through a shell on Windows, kill() would stop
  // only cmd.exe and leave the server holding the temporary folder open.
  const entry = join(
    folder,
    "node_modules",
    "@nodrail",
    "cli",
    "dist",
    "nodrail.mjs",
  );
  const child = spawn(process.execPath, [entry, "mcp", ...flags], {
    cwd: folder,
    env: {
      PATH: process.env.PATH,
      HOME: folder,
      USERPROFILE: folder,
      NODRAIL_TOKEN: "ndp_pack",
      NODRAIL_URL: url,
    },
  });
  const exited = new Promise((done) => child.once("exit", done));
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  try {
    const client = rpc(child);
    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pack", version: "1" },
    });
    if (init.result?.serverInfo?.name !== "nodrail")
      throw new Error(`initialize: ${JSON.stringify(init)} ${stderr}`);
    client.notify("notifications/initialized");
    const listed = await client.request("tools/list", {});
    return listed.result.tools.map((tool) => tool.name).sort();
  } finally {
    child.kill();
    await exited;
  }
}

/** Read-only by default; publishing only with --allow-publish. */
export async function checkMcp(folder, fail) {
  const nodrail = await fakeNodrail();
  try {
    const url = `http://127.0.0.1:${nodrail.address().port}`;
    const readOnly = await listTools(folder, url, []);
    if (readOnly.includes("publish_rules") || !readOnly.includes("whoami"))
      fail(`nodrail mcp tools: ${readOnly}`);
    const publishing = await listTools(folder, url, ["--allow-publish"]);
    if (!publishing.includes("publish_rules"))
      fail(`nodrail mcp --allow-publish tools: ${publishing}`);
  } finally {
    nodrail.close();
  }
}
