const test = require("node:test");
const assert = require("node:assert/strict");
test("runtime acceptance rejects PR, fork, stale commit and non-build artifacts", async () => {
  const { validateWorkflowRun } = await import("../scripts/ci/verify-run.mjs");
  const options = {
    repository: "fixture/meetspace",
    sourceCommit: "a".repeat(40),
    defaultBranch: "main",
    workflow: "desktop-build.yml",
  };
  const valid = {
    id: 123,
    head_repository: { full_name: options.repository },
    repository: { full_name: options.repository },
    head_sha: options.sourceCommit,
    head_branch: "main",
    path: ".github/workflows/desktop-build.yml",
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
  };
  assert.equal(validateWorkflowRun(valid, options).runId, "123");
  for (const mutate of [
    (r) => {
      r.event = "pull_request";
    },
    (r) => {
      r.head_repository.full_name = "attacker/fork";
    },
    (r) => {
      r.head_sha = "b".repeat(40);
    },
    (r) => {
      r.head_branch = "feature";
    },
    (r) => {
      r.path = ".github/workflows/untrusted.yml";
    },
    (r) => {
      r.conclusion = "failure";
    },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(
      () => validateWorkflowRun(invalid, options),
      /successful trusted workflow/,
    );
  }
});
