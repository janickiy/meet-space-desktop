import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function validateWorkflowRun(
  run,
  { repository, sourceCommit, defaultBranch, workflow },
) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(sourceCommit) ||
    run?.head_repository?.full_name !== repository ||
    run?.repository?.full_name !== repository ||
    run?.head_sha !== sourceCommit ||
    run?.head_branch !== defaultBranch ||
    run?.path !== `.github/workflows/${workflow}` ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !["push", "workflow_dispatch"].includes(run?.event)
  )
    throw new Error(
      "Only a successful trusted workflow on this exact default-branch commit may supply artifacts",
    );
  return { sourceCommit, runId: String(run.id) };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const id = process.env.SOURCE_RUN_ID;
  if (!/^[1-9]\d{0,19}$/.test(id ?? ""))
    throw new Error("Invalid source workflow run id");
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
    throw new Error("Invalid repository");
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${id}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("Cannot verify source workflow metadata");
  const run = await response.json();
  if (String(run.id) !== id) throw new Error("Source run identity mismatch");
  const result = validateWorkflowRun(run, {
    repository,
    sourceCommit: process.env.GITHUB_SHA,
    defaultBranch: process.env.DEFAULT_BRANCH,
    workflow: "desktop-build.yml",
  });
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `sourceCommit=${result.sourceCommit}\nrunId=${result.runId}\n`,
  );
}
