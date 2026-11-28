# Changelog

`@nodrail/sdk` continues `@nodrail/policy-engine` and `@nodrail/client`, which it
replaces. Their changelogs up to 0.9.2 follow, and new versions go above.

## Before @nodrail/sdk: @nodrail/policy-engine

### @nodrail/policy-engine 0.9.2

#### Patch Changes

- d963ec8: Security hardening from the first CodeQL review of the public monorepo: local secret and evidence files are read through a checked file descriptor (no symlink or swap between check and read), receipt and Markdown parsing no longer use backtracking-prone patterns, and telemetry writes its status atomically and refuses redirects. First release built from Nodrail/nodrail.
- 4384aaa: Point package metadata and documentation to the unified Nodrail repository.

### @nodrail/policy-engine 0.9.1

- Exercise Windows DPAPI, POSIX permissions, Keychain and stale lock recovery on every test host.

- Read machine credentials through the shared secret store with per-user Windows DPAPI and private POSIX permissions.

- Attach the server's per-call admission evidence to connected hook decision reports.

- Report project check tokens and redacted pause denials from connected hooks. Paused calls leave the local run and session pin unchanged.

- Show the control plane’s named pause reason in connected hooks. Preserve catalog provenance when rendering effective policy.

- Support removing an origin-bound machine credential during destroy. Show a pause message that covers both machine and caller access.

- Keep UUID machine IDs intact in hooks and derive a matching enrollment and telemetry identity from legacy hex files.

### @nodrail/policy-engine 0.9.0

One login, then `apply`: connected projects enroll each machine with its own
origin-bound credential, detect the calling agent per session, and report to
Inventory without extra tokens.

- Use one validated control-plane origin for enrollment and hooks, and report when a different project takes over the live policy.

- Added an origin-scoped machine credential store and allowed local mode without control-plane coordinates.

- Connected hooks use the configured entry agent when caller metadata is absent, validate project and revision admission, and surface environment takeovers.

- Connected hooks use origin-bound enrollment, check pause on every covered call, and keep deciding with a verified lock during rollout. Decision reports omit arguments by default and distinguish would-deny verdicts.
- Record the connected hook's latest policy check locally for nodrail status, including when it used cache or could not obtain policy.

### @nodrail/policy-engine 0.8.0

The connected hook: a host decides with the control plane's published
policy, shared budgets and evidence, and reports what it decided. 0.7.0 was
never published to npm; 0.8.0 includes its changes.

- Recognize Windows drive and UNC paths in file-contract checks, including
  resolved project aliases, while preserving symlink protections.
- Defer reading the Git revision for remote evidence until a gate needs it.
- Match shell globs against connection data paths, including brace
  alternatives and recursive segments.
- Measure command performance regressions in CPU time so runner contention
  does not cause spurious failures.
- Add `hook --connect` with conditional policy fetches, SHA-256 verification,
  matching-cache fallback, runtime evidence reads and watch mode.
- Queue host decisions, step receipts and outcomes for the existing runtime API.
- Remove the legacy `connectedGuard` entry point.
- The connected hook reserves shared budget capacity on the control plane before
  taking the run lock. A failed or expired lease denies the call with the reason.
  Outcomes settle leases through the background report sender.
- Decision reports and heartbeats send the policy digest used by the host. The
  hook warns when the cached file differs from `nodrail.lock.yaml`.

### @nodrail/policy-engine 0.7.0

Nodrail is the open control plane for AI agent development. A rule
only allows or denies: approvals are gone. The format has no other
name than Nodrail: `apiVersion: nodrail.com/v1alpha1`.

#### Added

- `connectedGuard` in `@nodrail/policy-engine/command-line`: the local
  hook's guards alone (protect list, setup, run ledger and git's folders,
  connections' data), for a hook that asks Nodrail for everything else.
- `connect:` in nodrail.yaml: the Nodrail, Cloud or self-hosted, a
  project is connected to (`url`, `workspace`, `environment`), who decides
  (`decide: cloud | local`, required), `enforce: on | watch` and the agent
  `credential` by reference. Read into the setup as `connect`; a project
  without it is unchanged.
- `hook --report <file>`: records each call the hook decides, and
  each outcome it sees (PostToolUse, PostToolUseFailure), in Nodrail's runs
  and Activity through `POST /api/v1/runtime/decisions`, with the
  credential the file names (`{ url, credential }`, as
  `.nodrail/connect.json` has them). Nodrail never decides them again. The
  hook only appends to a bounded queue in `~/.nodrail/decisions` and wakes
  a detached sender (`decisions-send`), as `--telemetry` does, so its
  answer never waits on the network and is the same with or without it.
  Keys are per call (host, session and tool call id), so a retry is the
  same row. Each decision carries the policy file's SHA-256. Exported for
  `nodrail` as `decisionSink` and `sendDecisionQueue` from
  `@nodrail/policy-engine/command-line`.

#### Changed

- Gates and budgets only deny while unmet. `otherwise` is optional
  and defaults to `deny`; the denial says what is missing (the receipt,
  evidence or budget), so the agent gets it done and tries again. Nothing
  waits for a person.
- The `repo-work` starter pack blocks damage instead of asking about it:
  `git push origin <branch>` is allowed for feature branches; pushes that
  name `main` or `master`, name no branch, or force (`--force`, `-f`,
  `--force-with-lease` written first) are denied; writes and edits to build
  scripts (`package.json`, makefiles…) and to `.github` are denied.
- A call no rule covers is denied with how to fix it: add a rule that
  allows it. `hook --unmatched` is `deny` (the default) or `allow`, which
  leaves the call to the host's own permissions.

#### Removed

- `require_approval`: a rule only allows or denies. A rule file with
  `effect: require_approval` fails to compile and says to use `deny`, with
  a gate, budget or evidence requirement to say when the call is allowed.
  The evaluator's outcome is `allow`, `deny` or `none`, and cases files
  expect one of those.
- `otherwise: require_approval` on gates and budgets; a file that has it
  fails to compile and says to write `otherwise: deny` or leave it out.
- `hook --unmatched ask`, and the local hook asking the person at the
  keyboard (`askPerson`, the `canAsk` option): the hook stops with exit
  code 2 and says what to use instead.
- Approval forms and their routes (contract surfaces S08 and C04):
  `approvals:` in `nodrail.yaml`, `approval:` on a rule or gate, the
  `approval` notification source, the `approver` server role in
  notifications, and `approvalBinding`/`approvalStillBinds`. A file that
  still has them fails to compile and says they were removed.

### @nodrail/policy-engine 0.6.0

#### Added

- Engine level 4: receipts read against their declared contract, and gates
  on them. A rule file that asks for level 4 can hold one `contracts` entry
  (`shapes`, `receipts`, `agents`) and gate requirements with `where`,
  `authority` and `subject: revision`; it compiles to a version 3 policy
  document. Engines up to level 3 refuse such a file. A receipt is valid,
  invalid or missing, and only a valid one gives a step its verdict; the
  explicit header bridge reads `RECEIPT <agent>` blocks such as a team's existing reviewer receipts.
  Receipts are captured on the stop event and on Claude Code's
  `SubagentHandback`, where an invalid receipt is denied so the subagent
  resends, and on Copilot's `subagentStop`; a step finishes once. Rule
  files without contracts behave exactly as before. See "How a receipt is
  read" in `docs/contracts.md`.
- `@nodrail/policy-engine/contracts` (also `/shapes`): the contracts
  compiler, digests, projections and `readContractReceipt`, for the CLI and
  Cloud. `@nodrail/policy-engine/contract-values`: the strict validator and
  `where` matcher with no dependencies, for browsers.
- `receiptText` and `HANDBACK_TOOL` in `@nodrail/policy-engine/hook-runs`,
  for hooks that send a receipt on.
- `@nodrail/policy-engine/files`: the file-content contracts parser and
  write reconstruction (preview). `@nodrail/policy-engine/revision`:
  `workRevision`, and `cleanRevision(commit)`, the revision a clean checkout
  of that commit reads, so CI evidence for a commit ties to the local work.

- Engine level 5 and policy document version 4.
  - **Evidence requirements on gates.** `{ evidence, authority, subject: revision, where }`, with `evidence` contracts in the rule file's `contracts` entry. A `where` on a secret path is refused. Local runtime-observed events are read from the ledger folder; externally verified ones are asked of Cloud with `hook --evidence <file>` (token in `NODRAIL_TOKEN`). Old subjects never satisfy new work. Explanations follow a fixed order.
  - **Numeric budgets.** `count: { tool, operation }`; `sum` of an `input.` (reserved) or `result.` (measured) integer path with its `unit`; `tokens` with `source: measured`; `per: step | run | day` with an IANA `timezone` for a day; `across: run | environment`. Labels are derived from the source: enforced allowance, measured usage, agent-reported usage.
  - **Reserve and settle in the local hook.** Reservations are made under the run lock and keyed `host:tool_use_id`, and a repeated PreToolUse is idempotent. PostToolUse consumes a reservation. Only a mediated `failed`/`not-called` releases one; anything else is unknown and still counted. Measured usage with no reading is unknown and holds.
  - Engines up to level 4 refuse level 5 files, and readers of version 3 refuse version 4. Files that use no level 5 feature compile exactly as before.
  - `@nodrail/policy-engine/ledger`: the run ledger (`record`, `withRunLock`), budget settlement for connectors (`settleMediatedCall`) and local evidence.
- `connection.call` events may carry `input_sha256`.
- `walk` is exported from `/contracts`.

#### Changed

- Gates now use only each agent's latest finished step, per revision with
  `subject: revision`. This changes existing gates too, including
  level-3 gates without contracts: a QA `pass` followed by a QA `fail` now
  closes a gate that 0.5.2 left open, and a later invalid receipt closes a
  gate an earlier valid one opened.
- A chain that makes a link (`ln`, `link`, `cp -s`) and runs anything after
  it is judged whole, as `command.compound`.

#### Fixed

- Agents could forge local evidence: the run ledger (`.git/nodrail`, or
  `NODRAIL_LEDGER`) wasn't protected, so a rule allowing `Write` let an
  agent append a `passed` event and open a gate. With a protect list, the
  hook now always denies file tools that change the ledger and shell
  commands that name it.
- All of `.git` is protected the same way, and a shell word counts
  as the shell joins it (`".git/nod""rail/…"`) and when a wildcard could
  reach `.git`, the ledger or a setup dot folder (`.gi?/…`, `sub/alt*`).
  Wildcards that can't reach them (`cp src/*.ts dist/`) are left to the
  rules. `shellWords` reads a line's words as the shell hands them over.
- With a protect list, the hook also denies a link pointing at, inside or
  above `.git`, the ledger or a setup dot folder, a recursive copy, move
  or sync into one, or into a folder holding one when it would create or
  overwrite it, or after another part of the same line, and an
  extraction into either.
  Shell analysis stays best effort: a control, not a sandbox.
- A gate on a command prefix was named by its internal `<id>-args` twin in
  deny reasons. `declaredGateId` and `declaredGates` give the declared id,
  each gate once.
- One invalid shape no longer brings false errors on every `where` that
  reads it: shape errors are reported alone.
- Four wrappers in a row (`nohup nohup nohup nohup gh …`) are read, as
  documented; a fifth is judged whole. It was three.
- An unknown key in nodrail.yaml is named with its path.
- The work revision was unknown whenever the tree had an untracked file
  (Node refused the string input git's `hash-object` was given), so a
  `subject: revision` requirement stayed unmet there. Untracked files are now
  hashed by content as documented.

- Briefs and tool inputs on declared contracts (engine level 4). A rule file's `contracts` entry takes `agents.<a>.brief` and
  `connections.<c>.operations.<op>.input`; rules and gates take `where` on
  `input.` and `brief.` paths. The hook checks the brief of the agent a
  dispatch starts (a fenced `nodrail-brief` block, or opted-in flat
  `key: value` lines) and a connection operation's arguments (strict:
  unknown arguments refused, 16 KiB) on the exact call, before any rule:
  invalid, missing or unobservable (Codex) is denied with a reason that
  names paths and codes, never values, so the agent never starts and the
  provider is never called. Classified arguments are shown to reviewers as
  `[classified]`. The compiled document (still version 3) carries
  `briefs`, `inputs` and each rule's `where` only when declared, so
  documents without them are unchanged; engines from before refuse them.
  `readBrief`, `briefContracts`, `inputContracts`, `checkContracts` in
  `/contracts`; `checkInput`, `checkValue`, `briefLines`,
  `withoutClassified` in `/contract-values`. New value issue code `size`.
  See "Briefs and tool inputs" in `docs/contracts.md`.
- The run ledger records a connector's mediated call as a
  `connection.call` event (`contractCheck`, `mediatedCall` schemas):
  input and result checks, and the provider execution, kept apart.

- The header bridge reads findings as an object of integer counts
  (`findings: 0 blocker / 1 major / 0 minor / 0 debt`), so a gate can ask
  `where: { findings.blocker: 0 }` of a flat receipt such as a team's existing one
  reviewer's.

#### Fixed

- A header findings line read into a list keeps only the categories
  counted above 0: `0 blocker / 1 major / 0 minor / 0 debt` was four
  findings, now one.
- Rules with gates or budgets but no contracts: a `SubagentHandback`
  finishes its step with the receipt it carries (read by the fixed
  parser), and the stop after it, which carries no message, adds nothing.
  A gate waiting for a subagent in `auto` mode stayed closed.
- The hook keeps run files where the environment it is given says
  (`HOME` outside git), not the process's own. `ledgerDirectory` and
  `nodrailDirectory` are in `@nodrail/policy-engine/hook-runs`.
- Copilot's dispatch in Claude Code's hook format (`Agent` with
  `agent_type`) is read as Copilot's `task`, so the agent started is the
  one named, not `general-purpose`.
- Claude Code's `SubagentHandback` (a subagent in `auto` permission mode
  delivering its report) goes ahead when no rule covers it. It was judged
  like any tool, so rules that block what they don't cover, such as the
  starter packs, stranded every background subagent ending this way. A
  rule on `claude-code subagenthandback` still decides it, and a receipt
  contract still refuses an invalid receipt. `HANDBACK_ACTION` in
  `@nodrail/policy-engine/hook-runs` names it for other evaluators.
- `receiptText` finds a header block under any title the grammar allows,
  `RECEIPT-{agent}` included; it only found titles with a space before the
  agent. `headerNaming(agent)` is the matcher, in `/contracts` and
  `/contract-values`.
- The policy hook never fails open: an error nothing caught, or the hook
  running past 15 s, ends a tool call with exit 2 (blocked); a step event
  ends with 0, so a subagent can still stop.

#### Added (preview, not enforced)

- The declared-contracts grammar, dialect 1: the `shapes` registry and
  where contracts attach (receipts, briefs, tool input and results,
  evidence, memory, files, approval forms, inventory labels) and how gates,
  rules, budgets, routes, views, insights, notifications, tests, locks and
  playbooks refer to them. Its compiler, digests and reporting projection
  are in `src/shapes/`, not yet exported or used by the hook or the CLI;
  published engines and CLIs refuse these declarations rather than ignore
  them. See `docs/contracts.md`.

#### Fixed

- A rule on a command didn't decide it when a wrapper ran it: a deny on
  `gh pr merge` missed `rtk gh pr merge`, and an allow on `rtk` covered
  everything rtk runs. The engine now judges the command that `rtk`,
  `nohup`, `time`, `caffeinate`, `nice` and `timeout` run, in shapes it
  knows; any other shape is judged as a whole. A rule on bare `rtk` no
  longer compiles: name rtk's own commands, such as `rtk gain`. See
  "Wrappers" in `docs/commands-and-tools.md`.

### @nodrail/policy-engine 0.5.2

#### Fixed

- A git that didn't answer within 2 s was read as "not a repository", so
  the run moved to `~/.nodrail` and lost its history: a gate could deny for
  no reason, and runs from different projects could share a ledger. git now
  has 5 s, and a timeout blocks the call with the reason ("git didn't answer
  within 5 s") and leaves a step unrecorded; the ledger never moves.

### @nodrail/policy-engine 0.5.1

#### Fixed

- Telemetry never decides: when the machine id can't be kept in
  `~/.nodrail` (for example, `.nodrail` is a file or isn't writable), the
  hook turned an allowed call into a block (exit 2). Telemetry now turns
  off with a warning and the rules' answer stands.
- A cut or malformed OTLP protobuf answer (`0a 02` with nothing after it)
  read as "all spans kept". Every length is checked against what arrived;
  such an answer leaves the spans unknown, never sent.

### @nodrail/policy-engine 0.5.0

GitHub Copilot CLI as a third host, and the reporting contract v2.

#### Fixed

- An invalid `nodrail.yaml` field is named, with why: "The manifest's
  fields are not valid: plugins.x.from.commit: A full commit id…". Before,
  the message didn't say which field.
- `nodrail-policy hook --connections` reads each connection's `data` and
  denies file tools and shell commands that reach it, whatever the rules
  say: agents reach a connection's data only through its operations.
- Codex couldn't load the project's own skills: it reads a skill through
  its shell, and the setup guard refused any command naming the setup's
  files, reads included. A read in a shape the hook knows exactly changes
  nothing, so the file rules now decide it. `cat`, `head`, `tail`, `nl` and
  `wc` on several files (up to 20) are judged as one read per file, so one
  secret among them still denies the command.
- Claude Code's `Skill` tool is described as `claude-code skill` on a
  `skill` resource named after the skill, and a Team's rules let each member
  load the skills its Agent lists. Before, a skill set up for an agent was
  denied when it loaded it (`no rule covers claude-code skill on Skill`).
  A project with a Team gets one allow per member and skill: run
  `nodrail policy lock` to review and record them.
- A connection with `-` in its name, such as `support-memory`, is read as
  declared on Codex, which calls it `mcp__support_memory__…`: it was denied
  as undeclared. Operations that differ only by `-` and `_` are refused,
  since Codex names them alike.

#### Changed

- A connection's locked files are every project file its command line
  names (`connectionPaths`), the command included, with or without `./` or
  as `--flag=value`; a `./` folder is accepted as data, unlocked. The
  `--protect-list` docs state the shell check's limits: words as written,
  not wildcards, variables or scripts.

#### Added

- GitHub Copilot CLI (preview): `hook --host copilot` reads Copilot's
  `preToolUse` calls (`bash`, `view`, `create`, `edit`, `rg`, `glob`,
  `web_fetch`, `task`, and MCP tools as `<server>-<tool>`) as the Claude
  Code calls they are, so the same rules and modules judge them, and
  answers in Copilot's shape. An `apply_patch` is judged once per file it
  names; a review is a deny. `runtimes: [copilot]` sets the team up in
  `.github/agents`, `.github/skills`, `.github/mcp.json` and
  `.github/hooks`, which are setup places agents can't change. A
  Claude Code hook that Copilot runs is detected and judged correctly.
- Reporting contract v2 (preview): every span carries `nodrail.schema=2`,
  the project's name and, with `id:` in `nodrail.yaml`, its stable
  `nodrail.project.id`. Decisions carry the policy's full SHA-256
  (`policyRevision`, the lock's `effective.sha256`), the machine
  (`machineId`) and the run; a run's steps and actions are sent as
  `nodrail.run.event` spans (`runEventSpan`, run keys hashed with
  `runRef`). `telemetry.traces.bearer` takes a secret by reference and
  sends it as `Authorization: Bearer`.
- The sender reads OTLP partial success (`deliveryOf`) and counts sent,
  refused, unknown and dropped spans apart in its status. A 4xx is final;
  408, 429, 5xx and network errors retry with the same span ids, which a
  receiver dedupes on.
- `decodeSpans` reads an OTLP/HTTP traces export, protobuf or JSON, for
  receivers.
- `id:` in a project manifest (a UUID), read into the setup as `id`.
- `@nodrail/policy-engine/compile`: `compilePolicies` without Node
  built-ins, for browsers.

- `plugins` and `agentPlugins` in a project manifest: plugin folders, their
  MCP servers' operations and who may use them. `connectionCall` reads
  `mcp__plugin_<plugin>_<server>__<tool>` (Claude Code) and, with host
  `codex`, `mcp__<server>__<tool>`; the hook takes `host`. Team rules let
  members given a plugin load its skills (`skill` prefix `<plugin>:`) and
  deny its operations to the rest. A plugin's skill keeps its `:`
  (`vercel:deploy`). `.claude-plugin` is a setup place.
- `tested` in a project manifest (proposed): exact versions for `nodrail`,
  `node`, `claude-code` and `codex`, read into the setup as `tested`.
- Telemetry (preview): `telemetry.traces` in `nodrail.yaml` (an OTLP/HTTP
  endpoint, protobuf or JSON, headers with secrets by reference), and
  `hook --telemetry <file>`, which sends each decision as a
  `nodrail.decision` span: the decision the host was told, the rule match,
  the agent, tool, operation, resource kind, host and policy revision, with
  the host's `session.id` and `gen_ai.tool.call.id`. Never arguments,
  resources, prompts or secrets. Spans wait in a bounded queue and a
  separate process sends them; a receiver that is down never delays a
  decision.

- Tool connections (preview): `nodrail.yaml` may declare `connections`, MCP
  servers by command, arguments, environment (secrets as `fromEnv` or
  `fromKeychain` references) and operations, and `agentConnections`, who
  may use which. A `./` file a connection runs is locked like a resource.
  A started Team's rules deny each member the connections and operations it
  isn't given. Names the engine uses for its own tools (`shell`, `files`…)
  are refused.
- `hook --connections <file>` reads a call to a declared connection as its
  declaration says: `mcp__handbook__search` with `collection: internal` is
  tool `handbook`, operation `search`, resource `collection` `internal`.
  An undeclared operation, or a missing resource argument, is denied.

- `nodrail.yaml` may say `runtimes: [claude-code, codex]` instead of
  `runtime`, for one file both hosts apply. `ProjectSetup.runtimes` lists the
  hosts; `runtime` is the host when there is only one. Both fields, or a host
  listed twice, is a problem.

### @nodrail/policy-engine 0.4.0

#### Added

- Setup resources (preview, `apf.nodrail.com/v1alpha1`): `nodrail.yaml` may
  say `runtime`, `team`, `resources` and `start`, and the resources declare
  `Agent`, `Team`, `Policy` and `PolicyBinding`. `resolveProject` reads them
  into `setup` and locks their files. A `PolicyBinding` renames the roles a
  module or Policy names to the team's agents, in `agent`, gate `requires` and
  `since`, budget `step_agent` and `kind: agent` resources. It refuses a name
  nobody plays, a role the policy doesn't name, two roles for one agent, and an
  agent off the team. A project without resources resolves as before.
- A started Team adds its own rules, last: each member may start only the
  members it hands off to, and no agent may change `.claude`, `.codex`,
  `.agents`, `.nodrail`, `nodrail.yaml` or `nodrail.lock.yaml`. Both are
  denies, on Claude Code and on Codex. Codex's calls on agents already
  started (wait, send input, close…) are allowed. `teamRules` and
  `SETUP_PLACES` are exported.
- The hook reads Codex's own agent calls: starting one
  (`collaborationspawn_agent`, `spawn_agent`) is `tool: codex`,
  `operation: agent` on its `agent_type`, as `claude-code` `agent` is for
  Claude Code; the other collaboration calls are `tool: codex` with their own
  operation, such as `wait_agent`. Before, Codex handoffs read as unknown
  Claude Code tools.
- A started Team's rules also deny agents running `nodrail`,
  `nodrail-policy` and `nodrail-claude-hook`, so none can lock and apply a
  setup it changed.
- `hook --protect-list <file>` protects the files a list names, as it
  protects its rule files: any file tool that would change one is denied,
  and a list that can't be read blocks.
- With `--protect-list`, the hook also denies shell commands naming a setup
  file, the list, `~/.nodrail`, or Nodrail itself by any path, whatever the
  rules allow.
- `hook --host codex` denies a call that needs a review, with the reason:
  Codex treats an `ask` answer as a failed hook and runs the call.
- A binding is refused when two names its policy uses would be one agent,
  including a role mapped onto an agent the policy already names. Role names
  like `constructor` are plain names. An agent's instructions and skills
  can't come from `.claude`, `.codex`, `.agents` or `.nodrail`.
- The hook also judges a shell command that only reads one file or searches
  a folder (`cat`, `head`, `tail`, `nl`, `wc`, `sed -n '<lines>p'`, `grep` on
  one file, `ls`, `rg`) as that file read or search, and the stricter
  decision holds. The file rules, secrets included, decide reads made through
  a shell as they decide the Read and Grep tools, and rules about commands
  keep their meaning. Paths the shell would expand, hidden-file searches and
  recursive grep stay commands. This is how Codex reads files.
- The read-only and repo-work packs allow Claude Code's task tools
  (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`) and `ToolSearch`.
- `ProjectHost.list`, optional, lists a folder's `.yaml` files for
  `resources: ./folder`. `renameAgents` is exported.

#### Changed

- The local hook judges each call as the agent Claude Code or Codex says made
  it: a subagent's type, or the session's `claude --agent`. `--agent` names
  the entry agent, for calls the host doesn't label. Before, every call in a
  session was judged as `--agent`. A rule for that agent no longer covers its
  subagents' calls; give them their own rules.

### @nodrail/policy-engine 0.3.0

Project manifests, a permission diff, and a safer reading of file paths.

#### Added

- `resolveProject` (`@nodrail/policy-engine/yaml`) composes a project's
  `nodrail.yaml` (`kind: nodrail.project/v1`): ordered imports of local rules
  files, nested manifests and catalog modules with typed values (`with:
{ repository: owner/name }`). A file shared by two imports is applied once.
  Cycles, paths or links that leave the project folder, unknown publishers,
  versions in the manifest and conflicting values are refused, each naming the
  reference. It reads only what its host gives it, so it runs in a browser too.
  `catalogEntry`, `canonicalId`, `parseModuleRef`, `bindingsUsed` and
  `joinPath` are exported with it.
- `permissionChanges(before, after)` and `renderPermissionChanges(changes)`
  (also from the package root): what an edit does to permissions, grouped by
  agent, operation and resource, as granted, revoked, tightened, loosened,
  changed or needs review. A change that weakens a deny, a gate or a budget is
  marked `!`. Checked against the evaluator with generated policies.
- `@nodrail/policy-engine/command-line` exports `runPolicyCommandLine(argv,
io)`: `nodrail-policy` as a function, which `nodrail policy` runs.
- File calls carry `file_name`, the file's own name, so a rule can allow files
  by name without matching folders that share it.

#### Changed

- The `read-only` starter pack also denies running `nodrail`, which can
  approve requests. `repo-work` protects `nodrail.yaml`, `nodrail.lock.yaml`
  and `.nodrail` like the other control places.
- `nodrail-policy` with a rules file it can't read prints the reason and exits
  2, instead of ending with an uncaught error.
- `nodrail-policy --version` prints the engine's own version when bundled into
  another command.

#### Fixed

- A link to a file that doesn't exist yet is judged by its target. Writing
  through it creates the target, which could otherwise pass a rule that
  protects that place, such as `repo-work`'s shell startup files.

### @nodrail/policy-engine 0.2.1

Package metadata and documentation only; the engine, CLI and hook behave
as in 0.2.0.

- npm description: "Compile, test and evaluate Agent Policy Format (APF)
  rules locally. Includes the CLI, TypeScript evaluator and local Claude Code
  hook." Keywords add `apf` and `agent-policy-format`.
- The quickstart starts in an empty folder with a two-rule policy, three
  proposed commands (allow, deny, none) and three CI cases.
- Gates, budgets and the `runs` command are marked as preview and name the
  engine release that has them.

### @nodrail/policy-engine 0.2.0

Gates, budgets and receipts. Engine level 3.

#### Breaking

- Starting a Claude Code subagent (`Agent`, and `Task`, its earlier name) is
  described with the subagent's type as resource `{ kind: agent, id: <type> }`
  instead of `{ kind: tool, id: Agent }`. A rule for `tool: claude-code`,
  `operation: agent` with resource kind `tool` is now a compile error that
  points to
  [Upgrading rules for subagents](docs/runs.md#upgrading-rules-for-subagents),
  instead of quietly never matching.
- A file with gates or budgets compiles to document `version: 2`, which
  earlier engines reject. `validate` reports what the files compiled to, such
  as `OK, compiled to 150 rules, 2 gates and 1 budget.`, instead of
  `OK: N rules.` The counts are compiled entries: a command prefix rule
  compiles to two.
- The hook's run key is `NODRAIL_RUN`, else `<repo>/<branch>` (the `origin`
  remote as host/owner/name, with no credentials, or the repository folder's
  name), pinned to the Claude Code session by its first event, so switching
  branch doesn't change the run. On the default branch, a detached HEAD or
  outside git it is `session:<id>`.
- A budget that covers an action decided with no run applies its `otherwise`,
  as a gate with no history holds. `eval`, `check` and `exec` decide with no
  run, so they hold too.

Upgrading: change rules for starting a subagent to the new resource.

```yaml fragment
# Before
- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: tool, match: exact, value: Agent }
  effect: allow

# After: any subagent, or match: exact, value: qa for one type
- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow
```

#### Added

- `gate` entries: an action that matches waits until named steps started and
  finished with accepted verdicts after the last work, otherwise `deny` or
  `require_approval`. A gate never allows on its own. Work is anything the
  `since` agents did, and any change by another agent than the one required:
  files written, edited, patched or deleted, and shell commands other than
  the read-only pack's look-around ones.
- `isChange(descriptor)` from the main entry says whether an action is such a
  change; action events take `change: true`. Old events without it are not
  changes.
- `budget` entries: tool calls per step or run, tokens and dollars per run,
  with a warning level.
- `simulate()` takes the run's history and reports gates, budgets and
  warnings with every decision.
- `parseReceipt()` and `receiptBlock()` in `@nodrail/policy-engine/receipts`
  read the receipt an agent ends its step with. They read only the last 16 KB
  of a message, and a block over `MAX_RECEIPT_TEXT` (8192 characters) is no
  receipt, as in Cloud.
- `legacySubagentRuleProblem()` from the main entry, the compile check above
  for a rule form.
- `renderPolicies()` keeps gates and budgets.
- `nodrail-policy hook` keeps a run ledger when the rules have gates or
  budgets: steps from `SubagentStart` and `SubagentStop`, receipts from the
  last message, every decided action. One JSON Lines file per run in the
  repository's git folder, with session pins next to it. Each decision reads,
  decides and records under a lock file; a call that waits over 5 seconds is
  blocked. A last line cut off mid-write is left out. Rules without gates or
  budgets never touch it.
- `nodrail-policy hook` denies any file tool change to the rule files and
  folders it loaded, before reading the rules.
- `nodrail-policy runs`, `runs show <run>` and `runs report`.
- `@nodrail/policy-engine/hook-runs`: `runKey()`, `receiptBlock()`,
  `MAX_RECEIPT_TEXT` and `agentName()` for hooks that report runs elsewhere,
  with no zod or YAML.
- Cases files take `run` and `step`, so gates and budgets can be tested in CI.
  `{ action: <agent>, command: <line> }` records a command; a `finished` with
  no open step records a whole step.
- A decision held by a used-up budget says so: "Budget … is at 61 of 60 tool
  calls. Over the limit, …".

#### Changed

- Problems in rule files point at what is wrong: an unknown key (`efect:`)
  at that key, a bad value, also inside `requires` or `resource`, at that
  value, a duplicate at its name or `id`, an unknown list at where it is
  named, `required_engine_version` at its value, and an item appended by an
  override in the file that appended it. They were at the start of the entry,
  some at column 1. Only `line` and `column` change; an issue has just
  `file`, `line`, `column` and `message`.
- Gates and budgets only make the rules' decision stricter. An action no
  rule covers stays blocked when an unmet gate or used-up budget only asks
  for a review.
- Both starter packs allow starting a Claude Code subagent. What it then does
  is still decided call by call.
- Both starter packs deny running `nodrail-policy` and `nodrail-claude-hook`
  from the shell. `repo-work` sends writes to `.npmrc` to a person.

### @nodrail/policy-engine 0.1.5

No changes to the engine; released with `@nodrail/client` 0.1.5. Tests now
fail if coverage drops.

### @nodrail/policy-engine 0.1.4

Fixes from a third independent review.

- Names are compared without regard to case, even for folders that don't exist
  yet: on many disks `.CLAUDE` is `.claude`, so a deny on `.claude` now holds.
- The `.env` family is recognised whatever its form (`.env-prod`, `prod.env`),
  and key files by extension (`*.pem`, `*.key`, `*.p12`, `*.pfx`).
- More places credentials live: `/proc/*/environ`, Claude Code's and Codex's
  sign-in files, Nodrail's own credential, and `.git/config`.
- A command argument with a wildcard or different case that could name a
  secret (`'.e*'`, `.en?`, `./.ENV`) makes the command never simple.
- A search of the home folder, or above it, counts as reaching secrets.
- `repo-work`: changes to `package.json`, makefiles and similar go to a person,
  and npm, pnpm and yarn flags that swap the shell or config make a command
  never simple. Its summary says plainly that tests run code the agent wrote.
- Redaction catches Stripe, GitLab, Google and npm keys, and names such as
  `OPENAI_KEY`.
- New: `reachesSecret()` and `SECRET_PLACES` decide secret reads the way the
  starter packs do.

### @nodrail/policy-engine 0.1.3

Fixes from a second independent review. Upgrade if you use the starter packs.

- The starter packs hold better:
  - `repo-work` allows writing only inside the folder the agent works in, and
    denies `.gitconfig`, `.husky`, `.mcp.json`, `.vscode`, `.ssh` and
    `LaunchAgents` as well as `.git`, the agents' settings and shell start-up
    files. Writing `~/.gitconfig` could make an allowed `git status` run code.
  - `read-only` denies searches whose file pattern could pick out a secret
    (`.env*`, `*env`, `{.env,x}`), and more places credentials live
    (`.envrc`, `.git-credentials`, `.pgpass`, SSH key files, `gh` tokens).
- A dot file with a suffix answers to its base: `.env.staging` contains `.env`.
- A command that names a place credentials live, such as
  `git log -p -- .env`, is never simple, so an allowed prefix doesn't cover it.
- New params for file calls: `inside_cwd`, and `reaches_secrets` for searches.
- Resolving a very deep path took quadratic time. Paths are now limited to
  4,096 characters and 256 levels, and resolved in linear time. A patch of
  more than 1,000 files can't be described, so a person reviews it.

### @nodrail/policy-engine 0.1.2

Security fixes found by an independent review. Upgrade if you rely on the
starter packs or on redaction.

- Reading what an agent wrote now takes linear time. A crafted command of a few
  hundred kilobytes could take minutes to describe, which in Codex would let the
  tool run when the hook timed out.
- A known token joined to other text by the shell, such as `0'ghp_…'`, is now
  redacted.
- A search is judged by every path it can reach: `Glob /home/me/.ssh/*` and
  Grep's `glob` now count as searching that folder.
- The starter packs deny reading or searching more places where credentials
  live (`.env.*`, `.gnupg`, `.kube`, `.docker`, `.npmrc` and others), no longer
  allow `git diff` or `git show` with arguments, and in `repo-work` deny writing
  to `.git`, `.claude`, `.codex` and shell start-up files.
- More commands that run other code are never simple: `git clone -u`,
  `--config` and `--template`, `--compress-program`, `zip -TT`, `man -P`,
  `pkexec`.
- New: `{ field, op: contains, list }` matches any item of a list. Files that
  use it declare `required_engine_version: 2`.
- Types now work with `moduleResolution: nodenext`.

### @nodrail/policy-engine 0.1.1

The first version published from GitHub Actions, with npm provenance: each
release can be traced to the commit and workflow that built it. No code changes.

### @nodrail/policy-engine 0.1.0

First public version: the evaluator, YAML rule files with lists, macros and layering, command and tool rules, the `nodrail-policy` command line, and the Claude Code hook.

## Before @nodrail/sdk: @nodrail/client

### @nodrail/client 0.9.2

#### Patch Changes

- d963ec8: Security hardening from the first CodeQL review of the public monorepo: local secret and evidence files are read through a checked file descriptor (no symlink or swap between check and read), receipt and Markdown parsing no longer use backtracking-prone patterns, and telemetry writes its status atomically and refuses redirects. First release built from Nodrail/nodrail.
- 4384aaa: Point package metadata and documentation to the unified Nodrail repository.
- Updated dependencies [d963ec8]
- Updated dependencies [4384aaa]
  - @nodrail/policy-engine@0.9.2

### @nodrail/client 0.9.1

- Extend coverage of unreadable project contracts and refused hand-back receipts.

- Preserve the agent pause reason when a retried action returns redacted digests.

- Ship the policy engine fix that keeps machine identity stable across enrollment and hook telemetry.

### @nodrail/client 0.9.0

Uses `@nodrail/policy-engine` 0.9.0.

- Bind saved credentials to the origin stored alongside them. Keep legacy Cloud credentials at the Cloud origin.

- The Claude Code plugin steps aside only for a verified installed project hook. Standalone connection settings require a complete origin and credential pair.

- Plugin hooks pair runtime credentials with their own origin, carry caller metadata and use the installed engine hook for applied projects.

### @nodrail/client 0.8.0

Uses `@nodrail/policy-engine` 0.8.0. 0.7.0 was never published to npm;
0.8.0 includes its changes.

- Add `policyIfChanged(etag?)` for conditional reads of the live policy.
  Existing SDK and standalone plugin authorization endpoints remain available.

### @nodrail/client 0.7.0

Uses `@nodrail/policy-engine` 0.7.0. Nothing waits for a person any more:
a call the rules don't allow is denied, with its reason.

#### Removed

- Waiting for a person. A call is allowed or denied at once: `authorize()`
  no longer polls, and loses `waitMs`, `pollMs` and `signal`; `createNodrail()`,
  `guard()` and `check()` lose `waitMs`; `NODRAIL_WAIT_SECONDS`,
  `NodrailClient.status()`, `NodrailClient.withdraw()` and
  `WITHDRAW_TIMEOUT_MS` are gone. A hold from an older server
  (`APPROVAL_PENDING`, `UNKNOWN_PERMISSION_BLOCKED`) is a deny with its
  reason.
- `HostDecision.verdict` is `allow` or `deny`; `require_approval` is gone.

#### Changed

- The plugin hooks' `PreToolUse` timeout is 30 seconds (it was 360, to wait
  for a person), and the hook denies a call Nodrail hasn't answered in 25.
- The `write-needs-review` example policy is now `write-after-review`: a gate
  that denies issue writes until a reviewer agent has passed the work.

#### Added

- `NodrailClient.policy()`: the live policy of the credential's environment
  (`GET /runtime/policy`, scope `policy:read`), with the file it was published
  from and its SHA-256, for a host that decides with its own engine.
- `NodrailClient.decisions(batch)`: records calls the hook decided on its
  host (`POST /runtime/decisions`, scope `decisions:write`) in their runs
  and Activity, at most 100 per call; each item answers its row or why it
  wasn't recorded. Nodrail never decides them again.
- `@nodrail/client/hooks`: `runHook`, the hook the plugins ship, for a
  command line that runs it in-process (`nodrail connect hook`).

### @nodrail/client 0.6.0

Uses `@nodrail/policy-engine` 0.6.0.

#### Added

- The hook reads `.nodrail/contracts.json`, which `nodrail apply` writes
  with the compiled brief and input contracts, from
  `CLAUDE_PROJECT_DIR` or the nearest folder above the call's `cwd`. A
  dispatch it covers sends its brief's reported fields as `params.brief`,
  an operation it covers sends classified inputs as `[classified]`, and
  an invalid brief or input is denied before Cloud is asked: the SDK's
  `withContractFields`, loaded from its own file
  (`dist/nodrail-hook-contracts.mjs`) only for a covered call, so the hook
  stays under 80 KB with no schema or YAML library. Without the file
  nothing changes. A file that can't be read, or a checker that can't be
  loaded for a covered call, blocks.

- The hook sends a flat `RECEIPT <agent>` header block as the receipt when
  no fenced block ends the message, so Cloud can read it with the agent's
  declared contract.
- A `SubagentHandback` (Claude Code `auto` mode) finishes its step with the
  receipt it carries; when Cloud answers that the receipt is invalid or
  missing, the hand-back is denied with the reason so the subagent resends.
  The call is then decided like any other.
- A call in a run sends the work revision it is about as `run.subject`
  (the git work tree at `cwd`, or the hook event's `cwd`), and again as the
  permit's `subject`, read afresh because the work may change while a person
  decides. Unknown is sent as `null`, never left out or guessed. Options
  `subject` and `cwd` change how it is read.
- `report(decision, outcome, { measured })` and `run(action, perform,
{ measure })` send the amounts a result measured (`result.` paths, whole
  non-negative numbers); any unusable amount leaves all of them out.
- `run(..., { timeoutMs })`: a call not waited for to the end, or one that
  rejects with `AbortError`/`TimeoutError`, is reported `unknown`, not
  `failure`; so is a Claude Code tool call that was interrupted.
- Reports are idempotent: the SDK keys each by its permit, and the client
  retries a network or server error twice with the same key; a key the
  server already has counts as reported.
- `contracts` option and `withContractFields`: given the published brief
  and input contracts, a guarded call is checked against its declared input
  before Cloud is asked (refused as `CONTRACT_REFUSED`, with paths and codes
  only), and Cloud receives each classified argument as `[classified]`; a
  dispatch carries its brief's reported fields as `params.brief`. The Claude
  Code hook doesn't read contracts yet: the hook stays a small bundle with
  no schema or YAML library, and has no source for them.
- Talking to a server from before these fields, the client asks once more
  without `subject` or `measured` when the server refuses them.

#### Fixed

- A header block whose title joins the agent without a space
  (`RECEIPT-qa`) is sent as the receipt too.
- An error thrown in a callback no longer ends the hook with exit 1, which
  Claude Code treats as no objection: a tool call is blocked (2), and any
  other event ends with 0 so a subagent can still stop.

### @nodrail/client 0.5.2

#### Fixed

- With the engine's change, a git that doesn't answer in time blocks the
  call ("git didn't answer within 5 s"), since a budget couldn't count it
  without its run; a step event is left unrecorded.

### @nodrail/client 0.5.1

Released with `@nodrail/policy-engine` 0.5.1, which it uses: the hook it
bundles carries that version's two telemetry fixes. Otherwise the client
behaves as in 0.5.0.

### @nodrail/client 0.5.0

Released with `@nodrail/policy-engine` 0.5.0, which it uses. The hook it
bundles judges GitHub Copilot CLI's calls (`--host copilot`) and sends
decisions in the reporting contract v2; see the engine's changelog.
Otherwise the client behaves as in 0.4.0.

### @nodrail/client 0.4.0

Released with `@nodrail/policy-engine` 0.4.0, which it uses. The hook
describes Codex's agent calls as that version does: starting one
(`collaborationspawn_agent`, `spawn_agent`) is `tool: codex`,
`operation: agent` on its `agent_type`, and the other collaboration calls are
`tool: codex` with their own operation. Before, they read as unknown Claude
Code tools. Otherwise the client and its hook behave as in 0.3.0.

### @nodrail/client 0.3.0

Released with `@nodrail/policy-engine` 0.3.0, which it uses; the client and its
hook behave as in 0.2.1. Its dependencies are updated.

### @nodrail/client 0.2.1

Package metadata and documentation only; the client and its hook behave
as in 0.2.0.

- npm description: "TypeScript client for Nodrail Cloud. Check supported tool
  calls against workspace policies and coordinate human approvals." Keywords
  add `tool-permissions`.
- The run-history walkthrough is marked as preview and names the client
  release that has `inRun` and `step`.

### @nodrail/client 0.2.0

Runs and steps for any agent framework, so gates and budgets work outside
Claude Code.

#### Breaking

- Starting a subagent in Claude Code (`Agent`, and `Task`, its earlier name)
  is now governed, as tool `claude-code`, operation `agent`, resource type
  `agent` with the subagent's type as id. Without a rule that allows it, each
  start waits for a person. Upgrading: add a rule that allows `claude-code`
  `agent` for the subagent types you use. Rule files with a rule for the
  earlier resource (type `tool`, id `Agent`) no longer compile.
- The Claude Code hook's run key is `NODRAIL_RUN`, else `<repo>/<branch>`
  pinned to the session by its first event, so switching branch doesn't
  change the run. On the default branch, a detached HEAD or outside git it is
  `session:<id>`. The repository is the `origin` remote as host/owner/name,
  with no credentials. Pins are kept in `.git/nodrail/sessions`.

#### Added

- A block says why when Cloud does: a gate tells the agent to run the steps
  it waits for (such as QA or review) after the last change and try again; a
  used-up budget and a paused agent are named too.
- `createNodrail({ run })`, or `NODRAIL_RUN`, sets the run calls belong to;
  `nodrail.inRun(key, work)` sets it for one piece of work.
- `nodrail.step(agent, work)` records a step around an agent's work. Calls
  made while it runs belong to it, through a framework's tool loop too, and
  the verdict is read from the result with `receiptOf`, or by your own
  function passed as `{ receipt }`.
- `authorize()` takes `run: { key, step? }` and sends it with the intent, so
  the server can decide gates and budgets on the run's history. The run is not
  part of the descriptor digest. `client.step()` records a step starting or
  finishing.
- The Claude Code hook sends each intent's run and step, and records
  `SubagentStart` and `SubagentStop` as steps with the receipt block. Recording
  a step never blocks the agent.
- The Codex hook sends the run with each call. Codex doesn't say which
  subagent makes a call, so every call is the main agent's.
- A call that stops waiting for a person withdraws its request, so it leaves
  Approvals instead of waiting there for someone to approve a call that will
  never run. `authorize()` does it when `waitMs` passes or its new `signal`
  aborts, and the Claude Code and Codex hooks at their own deadline too. It is
  best effort and takes at most 3 seconds; the call is blocked either way.
  With `waitMs: 0` the request stays open, to be decided later.
  `client.withdraw(actionId)` sends it by hand; it never allows anything.

#### Changed

- Receipts are read from the last 16 KB of a message only, and a block over
  8 KB is no receipt, in the hook and in `receiptOf` alike, as in Cloud.

### @nodrail/client 0.1.5

- New: `guardMcpServer(server)`. Every tool the server registers from then on
  is checked under the name it registers with, so a tool can't be guarded
  under the wrong name. Guarding a server that already has tools throws.
- A later `tool.update({ callback })` on a guarded MCP tool is checked too;
  before, it removed the check.
- Tests now fail if coverage drops.

### @nodrail/client 0.1.4

- Claude Code's reads (Read, Grep, Glob) are checked on the machine: one that
  reaches a place credentials live is blocked. Reads still aren't sent to
  Nodrail.
- The fixes in `@nodrail/policy-engine` 0.1.4.

### @nodrail/client 0.1.3

Fixes from a second independent review.

- MCP SDK tools are now really checked. The server keeps calling the object
  `registerTool` returns, so `guard` now puts the check inside that object and
  returns it; before, it returned a copy the server never used. Tested against
  the real MCP SDK client and server.
- A tool with two ways to run, such as `execute` and `run`, is refused instead
  of having only one checked. MCP task tools are refused until supported.
- The fixes in `@nodrail/policy-engine` 0.1.3.

### @nodrail/client 0.1.2

Security fixes found by an independent review. Upgrade.

- `guard()` no longer leaves a tool unchecked because of its shape. A provider
  tool that still runs locally, an MCP SDK registered tool (`callback`), or a
  tool that runs through `run()` passed through untouched in 0.1.0 and 0.1.1.
  Anything with code of its own is now checked, or refused with an error if its
  shape isn't recognised. A tool can no longer mark itself as already checked.
- The credential is never sent over plain `http`, except to this machine. Other
  addresses block with `INSECURE_URL`.
- Redaction fixes from `@nodrail/policy-engine` 0.1.2.
- A credential loaded after the tools were wrapped is picked up.
- MCP SDK registered tools are supported.
- Types now work with `moduleResolution: nodenext`.

### @nodrail/client 0.1.1

The first version published from GitHub Actions, with npm provenance: each
release can be traced to the commit and workflow that built it. No code changes.

### @nodrail/client 0.1.0

First public version:

- `guard()` for LangChain, the Vercel AI SDK, the OpenAI Agents SDK, Mastra,
  LlamaIndex, the Anthropic SDK tool runner, the Claude Agent SDK, OpenAI SDK
  `runTools`, and any function.
- `nodrailMiddleware()` for LangChain agents (`@nodrail/client/langchain`).
- `createNodrail()` with `run()`, `check()` and `report()`, and the low-level
  `NodrailClient`.
- The one-file hook for Claude Code and Codex, and their hook settings
  (`@nodrail/client/setup`).
