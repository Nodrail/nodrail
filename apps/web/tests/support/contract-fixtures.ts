// A reviewer receipt contract compiled by the engine itself, as the CLI
// would publish it and a hook would report against it: shared by the wire,
// ingest, inspector and explanation tests, so all of them read the same
// digests, projection and withheld paths.
import type { ContractEventDto } from "@/contracts/v1/contract-events";
import {
  compileContracts,
  type CompiledShape,
} from "@/contracts/v1/shapes-engine";

const compiled = compileContracts({
  manifest: {
    shapes: {
      "reviewer-result": {
        properties: {
          verdict: {
            values: ["ship", "ship-with-debt", "fix-first"],
            role: "verdict",
          },
          issue: { type: "string", max: 100, for: "Issue id from the brief" },
          lesson: {
            type: "string",
            max: 300,
            optional: true,
            report: true,
            for: "A useful lesson",
          },
          findings: {
            role: "findings",
            report: true,
            properties: {
              blocker: { type: "integer", min: 0 },
              major: { type: "integer", min: 0 },
            },
          },
          anchor: { values: ["fresh", "stale"] },
          note: { type: "string", optional: true, classification: "secret" },
        },
      },
    },
    receipts: { reviewer: { shape: "reviewer-result" } },
  },
  resources: [
    {
      apiVersion: "nodrail.com/v1alpha1",
      kind: "Agent",
      metadata: { name: "reviewer" },
      spec: { receipt: "reviewer" },
    },
  ],
});
if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));

export const reviewer: CompiledShape =
  compiled.contracts!.shapes["reviewer-result"]!;

/** What `nodrail workspace publish` sends for the reviewer receipt. */
export const revisionInput = () => ({
  digest: reviewer.contract,
  name: "reviewer-result",
  surface: "receipt",
  dialect: 1,
  shape: reviewer.shape,
});

/** What a reporting client registers before its first report. */
export const projectionInput = () => ({
  digest: reviewer.projection.digest,
  contract_digest: reviewer.contract,
  name: "reviewer-result",
  surface: "receipt",
  dialect: 1,
  shape: reviewer.projection.shape,
  withheld: reviewer.projection.withheld,
});

export const closureInput = () => ({
  revisions: [revisionInput()],
  bindings: [
    {
      surface: "receipt",
      target: "receipt:reviewer",
      contract_digest: reviewer.contract,
    },
  ],
});

/** A reported receipt span's attributes, as they arrive: strings only. */
export const receiptAttributes = (extra: Record<string, string> = {}) => ({
  "nodrail.machine": "f".repeat(32),
  "nodrail.host": "claude-code",
  "nodrail.agent": "reviewer",
  "nodrail.run": "e".repeat(32),
  "nodrail.step": "review",
  "nodrail.contract.surface": "receipt",
  "nodrail.contract.name": "reviewer-result",
  "nodrail.contract.digest": reviewer.contract,
  "nodrail.contract.dialect": "1",
  "nodrail.contract.projection": reviewer.projection.digest,
  "nodrail.contract.producer": "agent-reported",
  "nodrail.contract.capture": "captured",
  "nodrail.contract.validation": "valid",
  "nodrail.contract.findings": "1",
  "nodrail.contract.payload": JSON.stringify({
    verdict: "ship",
    findings: { blocker: 0, major: 1 },
  }),
  ...extra,
});

/** The attributes without some keys. */
export const without = (
  attributes: Record<string, string>,
  ...keys: string[]
) =>
  Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !keys.includes(key)),
  );

/** A digest of the engine's form that names nothing stored. */
export const otherDigest = (c: string) => `sha256:${c.repeat(64)}`;

/** A valid reported reviewer receipt as the inspector receives it. */
export const receiptEvent = (
  overrides: Partial<ContractEventDto> = {},
): ContractEventDto => ({
  id: "6f0c8a3e-1d2b-4c5d-8e9f-0a1b2c3d4e5f",
  surface: "receipt",
  coverage: "S01",
  contract: {
    name: "reviewer-result",
    digest: reviewer.contract,
    dialect: 1,
    projectionDigest: reviewer.projection.digest,
    availability: "projection_only",
  },
  provenance: {
    authority: "reported",
    producerClass: "agent-reported",
    sourceLabel: "Local enforcement · reported by this installation",
    person: "Ada",
    mine: true,
    machine: "ffffffff",
    project: "desk",
    projectBound: true,
    host: "claude-code",
    agent: "reviewer",
    run: "e".repeat(32),
    step: "review",
    subject: null,
    occurredAt: "2026-11-21T10:00:00.000Z",
    receivedAt: "2026-11-21T10:00:01.000Z",
  },
  capture: "captured",
  validation: "valid",
  validatedBy: "producer",
  projectionValidation: "valid",
  verdict: "ship",
  findingsCount: 1,
  execution: null,
  delivered: null,
  fields: { verdict: "ship", findings: { blocker: 0, major: 1 } },
  redacted: reviewer.projection.withheld,
  absent: ["lesson"],
  issues: [],
  issueCount: 0,
  authorizes: false,
  ...overrides,
});

/** The same receipt, as a Cloud runtime submission the server validated. */
export const authoritativeEvent = (
  overrides: Partial<ContractEventDto> = {},
): ContractEventDto =>
  receiptEvent({
    provenance: {
      authority: "authoritative",
      producerClass: "runtime-observed",
      sourceLabel: "Cloud-managed action",
      installation: "laptop",
      agent: "reviewer",
      runId: null,
      step: "review",
      actionDigest: null,
      subject: { revision: "c".repeat(40), source: "runtime-observed" },
      occurredAt: "2026-11-21T10:00:00.000Z",
      receivedAt: "2026-11-21T10:00:01.000Z",
    },
    validatedBy: "server",
    authorizes: true,
    ...overrides,
  });
