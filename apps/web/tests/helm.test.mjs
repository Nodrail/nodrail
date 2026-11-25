import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";

const chart = fileURLToPath(
  new URL("../deploy/helm/nodrail/", import.meta.url),
);
const args = ["template", "test", chart];
const serverDigest = "sha256:" + "a".repeat(64);
const migrateDigest = "sha256:" + "b".repeat(64);

function render(...values) {
  const yaml = execFileSync("helm", [...args, ...values], { encoding: "utf8" });
  return Object.fromEntries(
    parseAllDocuments(yaml).map((document) => {
      const manifest = document.toJS();
      return [manifest.kind, manifest];
    }),
  );
}

await test("verified digests bind the Deployment, migration Job and scheduler", () => {
  const { Deployment, Job, CronJob } = render(
    "--set-string",
    `image.tag=old,migration.tag=old,image.digest=${serverDigest},migration.digest=${migrateDigest}`,
  );
  const image = (pod) => pod.containers[0].image;
  assert.equal(
    image(Deployment.spec.template.spec),
    `ghcr.io/nodrail/server@${serverDigest}`,
  );
  assert.equal(
    image(Job.spec.template.spec),
    `ghcr.io/nodrail/server-migrate@${migrateDigest}`,
  );
  assert.equal(
    image(CronJob.spec.jobTemplate.spec.template.spec),
    `ghcr.io/nodrail/server@${serverDigest}`,
  );
});

await test("all workload pods meet the Linux Restricted security context requirements", () => {
  const { Deployment, Job, CronJob } = render();
  for (const pod of [
    Deployment.spec.template.spec,
    Job.spec.template.spec,
    CronJob.spec.jobTemplate.spec.template.spec,
  ]) {
    assert.equal(pod.securityContext.runAsNonRoot, true);
    assert.equal(pod.securityContext.runAsUser, 1000);
    assert.equal(pod.securityContext.seccompProfile.type, "RuntimeDefault");
    for (const container of pod.containers) {
      assert.equal(container.securityContext.allowPrivilegeEscalation, false);
      assert.deepEqual(container.securityContext.capabilities.drop, ["ALL"]);
    }
  }
});

const ingress = [
  "--set",
  "ingress.enabled=true,ingress.host=control.example.org",
];
const tls = ["--set", "ingress.tls[0].secretName=control-tls"];

await test("ingress requires a matching origin, with HTTPS for public sign-in", () => {
  const rejects = (values, error) => {
    const result = spawnSync("helm", [...args, ...ingress, ...values], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
  };
  rejects([], /appOrigin is required/);
  rejects(
    ["--set", "appOrigin=http://localhost:3000"],
    /must match ingress.host/,
  );
  rejects(
    ["--set", "appOrigin=https://control.example.org/app"],
    /must be an HTTPS origin/,
  );
  rejects(
    ["--set", "appOrigin=http://control.example.org"],
    /must be an HTTPS origin/,
  );

  for (const { origin, extra } of [
    { origin: "https://control.example.org:8080", extra: [] },
    { origin: "https://control.example.org", extra: tls },
  ]) {
    const { Ingress, Deployment } = render(
      ...ingress,
      "--set",
      `appOrigin=${origin}`,
      ...extra,
    );
    assert.equal(Ingress.spec.rules[0].host, "control.example.org");
    const env = Deployment.spec.template.spec.containers[0].env;
    assert.equal(env.find(({ name }) => name === "APP_ORIGIN").value, origin);
  }
});
