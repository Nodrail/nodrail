import { isDeepStrictEqual } from "node:util";
import { isMap, yamlObject } from "./parse-yaml.mjs";

const read = { contents: "read" };
const pullRequest = ["pull_request"];
const manual = [...pullRequest, "workflow_dispatch"];

const workflows = new Map([
  ["workflows/ci.yml", { events: manual, top: read }],
  ["workflows/server-ci.yml", { events: manual, top: read }],
  ["workflows/dependency-review.yml", { events: pullRequest, top: read }],
  ["workflows/pr-title.yml", { events: pullRequest, top: {} }],
  ["workflows/workflow-audit.yml", { events: manual, top: read }],
  ["workflows/public-policy.yml", { events: manual, top: read }],
  [
    "workflows/marketplace.yml",
    {
      events: ["workflow_dispatch"],
      top: read,
      environments: { generate: "marketplace" },
    },
  ],
  [
    "workflows/codeql.yml",
    {
      events: ["pull_request", "push", "schedule"],
      push: { branches: ["main"] },
      top: {},
      jobs: { analyze: { ...read, "security-events": "write" } },
    },
  ],
  [
    "workflows/release.yml",
    {
      events: ["push", "workflow_dispatch"],
      push: { branches: ["main"] },
      releaseKind: "npm",
      top: read,
      environments: { stage: "npm" },
      jobs: {
        version: { contents: "write", "pull-requests": "write" },
        stage: { ...read, "id-token": "write" },
        record: { contents: "write" },
      },
      gated: {
        stage: "inputs.operation == 'stage'",
        record: "inputs.operation == 'record'",
      },
      // stage builds the dispatched main commit (npm provenance must name
      // what was built); its script checks the packages match the tag's.
      fullHistory: ["stage"],
      pinned: ["record"],
    },
  ],
  [
    "workflows/scorecard.yml",
    {
      events: ["push", "schedule"],
      push: { branches: ["main"] },
      top: {},
      jobs: {
        analysis: {
          ...read,
          actions: "read",
          "security-events": "write",
          "id-token": "write",
        },
      },
    },
  ],
  [
    "workflows/server-release.yml",
    {
      events: ["workflow_dispatch"],
      releaseKind: "image",
      top: read,
      gated: {
        candidates: undefined,
        "self-hosted": undefined,
        publish: undefined,
      },
      pinned: ["candidates", "self-hosted"],
      jobs: {
        candidates: { ...read, packages: "write" },
        "self-hosted": { ...read, packages: "read" },
        publish: { ...read, packages: "write", "id-token": "write" },
      },
    },
  ],
]);

function checkTriggers(on, policy) {
  if (!isMap(on) || !Object.keys(on).length) return false;
  if (!Object.keys(on).every((event) => policy.events.includes(event)))
    return false;
  return !policy.push || isDeepStrictEqual(on.push, policy.push);
}

const allowedPermissions = (permissions, allowed) =>
  isMap(permissions) &&
  Object.entries(permissions).every(
    ([scope, access]) =>
      Object.hasOwn(allowed, scope) && allowed[scope] === access,
  );

function hasAlternateCase(map, keys) {
  return Object.keys(map).some(
    (key) => keys.includes(key.toLowerCase()) && key !== key.toLowerCase(),
  );
}

function safeStep(step, checkoutOptions) {
  if (!isMap(step) || hasAlternateCase(step, ["uses", "with"])) return false;
  if (!Object.hasOwn(step, "uses")) return typeof step.run === "string";
  if (typeof step.uses !== "string") return false;
  if (!/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[a-f0-9]{40}$/i.test(step.uses))
    return false;
  if (!/^actions\/checkout(?:\/|@)/i.test(step.uses)) return true;
  // Check out the event's repository and ref using the default ephemeral token.
  return isDeepStrictEqual(step.with, {
    "persist-credentials": false,
    ...checkoutOptions,
  });
}

function checkoutPolicy(policy, name) {
  if (policy.releaseKind && name === "verify") return { "fetch-depth": 0 };
  if (policy.fullHistory?.includes(name)) return { "fetch-depth": 0 };
  if (policy.pinned?.includes(name))
    return { ref: "${{ needs.verify.outputs.commit }}" };
  return {};
}

function gatedJobProblem(policy, name, job) {
  if (!policy.gated || !Object.hasOwn(policy.gated, name)) return null;
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
  if (!needs.includes("verify") || job.if !== policy.gated[name])
    return `${name}: publishing identity requires successful protected-main verification`;
  return null;
}

function invalidJob(job) {
  return (
    !isMap(job) ||
    Object.hasOwn(job, "uses") ||
    hasAlternateCase(job, [
      "permissions",
      "steps",
      "uses",
      "environment",
      "needs",
      "if",
      "continue-on-error",
    ])
  );
}

function jobProblems(jobs, policy) {
  if (!isMap(jobs) || !Object.keys(jobs).length) return ["missing jobs"];
  const problems = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (invalidJob(job)) {
      problems.push(`${name}: reusable or invalid job`);
      continue;
    }
    if (
      Object.hasOwn(job, "permissions") &&
      !allowedPermissions(job.permissions, policy.jobs?.[name] ?? policy.top)
    )
      problems.push(`${name}: unsafe job permissions`);
    if (job.environment !== policy.environments?.[name])
      problems.push(`${name}: unsafe job environment`);
    const gateProblem = gatedJobProblem(policy, name, job);
    if (gateProblem) problems.push(gateProblem);
    const checkoutOptions = checkoutPolicy(policy, name);
    if (
      !Array.isArray(job.steps) ||
      !job.steps.every((step) => safeStep(step, checkoutOptions))
    )
      problems.push(`${name}: unsafe action or checkout configuration`);
  }
  return problems;
}

function releaseVerificationSteps(steps, env, kind) {
  if (!Array.isArray(steps) || steps.length !== 2 || !steps.every(isMap))
    return false;
  const [checkout, pin] = steps;
  const tag = kind === "npm" ? "RELEASE_TAG" : "NODRAIL_VERSION";
  return (
    String(checkout.uses).startsWith("actions/checkout@") &&
    !checkout.if &&
    !checkout["continue-on-error"] &&
    pin.id === "pin" &&
    pin.run === `node scripts/verify-release.mjs ${kind} "$${tag}"` &&
    (pin.env?.[tag] ?? env?.[tag]) === "${{ inputs.tag }}" &&
    !pin["continue-on-error"] &&
    !pin.if
  );
}

function hasReleaseGate(workflow, policy) {
  if (!policy.releaseKind) return true;
  const { verify } = workflow.jobs ?? {};
  const kind = policy.releaseKind;
  const expectedIf =
    "github.repository == 'Nodrail/nodrail' && github.ref == 'refs/heads/main'" +
    (kind === "npm"
      ? " && github.event_name == 'workflow_dispatch' && vars.NPM_PUBLISH_ENABLED == 'true'"
      : "");
  return (
    verify?.if === expectedIf &&
    verify.outputs?.commit === "${{ steps.pin.outputs.commit }}" &&
    !verify["continue-on-error"] &&
    releaseVerificationSteps(verify.steps, workflow.env, kind)
  );
}

export function workflowProblems(path, text) {
  if (!/^\.github\/workflows\//i.test(path)) return [];
  const policy = workflows.get(path.slice(".github/".length));
  if (!policy) return [`${path}: workflow is not allowlisted`];

  let workflow;
  try {
    workflow = yamlObject(text);
  } catch {
    return [`${path}: invalid workflow YAML`];
  }
  if (
    !isMap(workflow) ||
    hasAlternateCase(workflow, ["on", "permissions", "jobs"])
  )
    return [`${path}: invalid workflow`];
  const runsOnPullRequest =
    isMap(workflow.on) && Object.hasOwn(workflow.on, "pull_request");
  const problems = jobProblems(workflow.jobs, policy);
  if (!hasReleaseGate(workflow, policy))
    problems.push("missing protected-main release verification");
  if (!checkTriggers(workflow.on, policy))
    problems.push("unsafe workflow triggers");
  if (!allowedPermissions(workflow.permissions, policy.top))
    problems.push("unsafe workflow permissions");
  if (runsOnPullRequest && /\$\{\{[^}]*\bsecrets\b/i.test(text))
    problems.push("pull request workflow references the secrets context");
  return problems.map((problem) => `${path}: ${problem}`);
}
