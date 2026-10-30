import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
  utimes,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sourceInputs } from "./ci/source-inputs.mjs";
import {
  makeBuildProvenance,
  readReleaseConfig,
  sourceDateEpoch,
} from "./build-context.mjs";
import { readBuilderEvidence } from "./prepare-builder.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const frontend = path.resolve(desktop, "../frontend");
const repository = path.resolve(desktop, "..");
const pkg = JSON.parse(
  await readFile(path.join(desktop, "package.json"), "utf8"),
);
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Cannot record the source checkout for this build");
  return result.stdout.trim();
};
const releaseMode = process.env.MEETSPACE_BUILD_MODE ?? "test";
if (!["test", "release"].includes(releaseMode))
  throw new Error("Invalid build mode");
const macReleasePolicy = releaseMode === "release" && process.env.MEETSPACE_BUILD_TARGET === "darwin"
  ? await import("./macos-release-policy.mjs") : null;
const config =
  releaseMode === "release"
    ? await (macReleasePolicy?.readMacReleaseConfig ?? readReleaseConfig)(process.env.MEETSPACE_RELEASE_CONFIG)
    : null;
// Only the Windows packaging driver prepares NSIS. Shared compilation and
// macOS/Linux builds must never mutate Windows builder code as a side effect.
const builderPatch = process.env.MEETSPACE_BUILD_TARGET === "win32"
  ? await readBuilderEvidence()
  : undefined;
// Licensing resources are generated from the locked installed packages before
// the source snapshot. Their output is deterministic and contains no credentials.
const notices = spawnSync(
  process.execPath,
  [path.join(desktop, "scripts/generate-third-party-notices.mjs")],
  { cwd: desktop, stdio: "inherit" },
);
if (notices.error || notices.status !== 0)
  throw new Error("Cannot generate bundled license notices");
const inputs = await sourceInputs(repository, releaseMode === "release");
const epoch = sourceDateEpoch(
  process.env.SOURCE_DATE_EPOCH,
  git("show", "-s", "--format=%ct", "HEAD"),
);
const provenance = {
  ...(macReleasePolicy?.makeMacBuildProvenance ?? makeBuildProvenance)({
    pkg,
    inputs,
    epoch,
    releaseMode,
    config,
  }),
  ...(builderPatch ? { builderPatch } : {}),
};
const buildEnvironment = {
  ...process.env,
  VITE_BUILD_VERSION: provenance.buildVersion,
  VITE_BUILD_COMMIT: provenance.sourceCommit,
  VITE_BUILD_TIME: provenance.buildTime,
  SOURCE_DATE_EPOCH: String(epoch),
  TZ: "UTC",
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => {
  const result = spawnSync(npm, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: buildEnvironment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Build command failed (${result.status})`);
};

// Compile the privileged shell before copying the shared, unprivileged renderer.
await rm(path.join(desktop, "dist"), { recursive: true, force: true });
run(["run", "build:main"], desktop);
await writeFile(
  path.join(desktop, "dist/build-provenance.json"),
  JSON.stringify(provenance, null, 2) + "\n",
);
await writeFile(
  path.join(desktop, "dist/update-trust.json"),
  JSON.stringify(config?.updateTrust ?? { enabled: false }, null, 2) + "\n",
);
await writeFile(
  path.join(desktop, "dist/source-inputs.json"),
  JSON.stringify(inputs, null, 2) + "\n",
);
if (releaseMode === "release")
  await rm(path.join(desktop, "dist/acceptance.js"), { force: true });
run(["run", "build", "--", "--mode", "desktop"], frontend);
const renderer = path.join(desktop, "renderer");
const source = path.join(frontend, "dist-desktop");
const html = await readFile(path.join(source, "index.html"), "utf8");
if (!html.includes('<div id="root"></div>')) {
  throw new Error(
    "Expected shared frontend desktop build is missing its React root",
  );
}
await rm(renderer, { recursive: true, force: true });
await mkdir(renderer, { recursive: true });
await cp(source, renderer, { recursive: true });
const normalize = async (directory) => {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) await normalize(filename);
    await utimes(filename, epoch, epoch);
  }
  await utimes(directory, epoch, epoch);
};
await normalize(path.join(desktop, "dist"));
await normalize(renderer);
console.log(
  "Compiled desktop shell and copied the shared frontend desktop renderer.",
);
