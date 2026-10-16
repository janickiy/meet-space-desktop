import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { lstat, realpath, readFile, rm } from "node:fs/promises";
import { readReleaseConfig } from "./build-context.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const requested = process.argv[2];
const signed = process.argv[3] === "--signed";
if (
  !["x64", "arm64", "all"].includes(requested) ||
  (signed ? process.argv.length !== 5 : process.argv.length !== 3)
)
  throw new Error(
    "Use package.mjs x64|arm64|all [--signed <absolute-reviewed-config.json>]",
  );
const configPath = signed ? process.argv[4] : undefined;
const config = signed ? await readReleaseConfig(configPath) : null;
if (signed) {
  if (process.platform !== "win32" || requested !== process.arch)
    throw new Error(
      "Signed candidates require a native Windows runner for the explicit architecture",
    );
  if (config.signing.mode === "pfx") {
    if (!process.env.WIN_CSC_LINK || !path.isAbsolute(process.env.WIN_CSC_LINK))
      throw new Error("An external PFX path is required");
    const filename = await realpath(process.env.WIN_CSC_LINK),
      repository = await realpath(path.resolve(desktop, ".."));
    const info = await lstat(filename);
    if (
      !info.isFile() ||
      info.size > 1024 * 1024 ||
      filename === repository ||
      filename.startsWith(repository + path.sep)
    )
      throw new Error("Signing certificate must be outside the repository");
  }
}
const run = (args, env = process.env) => {
  const result = spawnSync(process.execPath, args, {
    cwd: desktop,
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
const environment = {
  ...process.env,
  MEETSPACE_BUILD_MODE: signed ? "release" : "test",
  MEETSPACE_RELEASE_CONFIG: configPath ?? "",
};
run([path.join(desktop, "scripts/build.mjs")], environment);
const provenance = JSON.parse(
  await readFile(path.join(desktop, "dist/build-provenance.json"), "utf8"),
);
const pkg = JSON.parse(
  await readFile(path.join(desktop, "package.json"), "utf8"),
);
environment.SOURCE_DATE_EPOCH = String(provenance.sourceDateEpoch);
environment.TZ = "UTC";
delete environment.ELECTRON_BUILDER_COMPRESSION_LEVEL;
const builder = require.resolve("electron-builder/out/cli/cli.js");
// Each target is packaged separately: an arm64-named installer must contain arm64.
for (const arch of requested === "all" ? ["x64", "arm64"] : [requested]) {
  // A failed prior build may leave an archive whose new mtime makes builder
  // consider it fresher than our normalized package. Never reuse that archive.
  const output = signed
    ? path.join(desktop, "artifacts", "signed", arch)
    : path.join(desktop, "artifacts");
  await rm(path.join(output, `${pkg.name}-${pkg.version}-${arch}.nsis.7z`), {
    force: true,
  });
  const builderEnvironment = {
    ...environment,
    MEETSPACE_TARGET_ARCH: arch,
    CSC_LINK: "",
    CSC_KEY_PASSWORD: "",
    CSC_IDENTITY_AUTO_DISCOVERY: signed ? "true" : "false",
    WIN_CSC_LINK:
      signed && config.signing.mode === "pfx" ? process.env.WIN_CSC_LINK : "",
    WIN_CSC_KEY_PASSWORD:
      signed && config.signing.mode === "pfx"
        ? process.env.WIN_CSC_KEY_PASSWORD
        : "",
  };
  run(
    [
      builder,
      "--config",
      signed
        ? "electron-builder.release.config.cjs"
        : "electron-builder.config.cjs",
      "--win",
      "nsis",
      `--${arch}`,
      "--publish",
      "never",
    ],
    builderEnvironment,
  );
  run(
    [
      path.join(desktop, "scripts/verify-artifacts.mjs"),
      arch,
      ...(signed ? ["--signed", configPath] : []),
    ],
    environment,
  );
}
