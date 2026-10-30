// Narrow, reviewed repair for the pinned builder's asynchronous NSIS language
// include order. This is build tooling only; it is not shipped in app.asar.
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
export const BUILDER_VERSION = "26.17.0";
export const BUILDER_UPSTREAM_SHA256 = "fa6d32306dc6eb12d656c4c821aad691f0efa47508df100ef046364d409c521f";
export const BUILDER_PATCHED_SHA256 = "12dd62260619425bd6bd981336db22ca2c04c62bc1219918ced7da053e3df455";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = () => ({ package: "app-builder-lib", version: BUILDER_VERSION,
  patch: "serialize-nsis-language-includes-v1", sourceSha256: BUILDER_PATCHED_SHA256 });
const statements = [
  '        taskManager.addTask((0, nsisLang_1.addCustomMessageFileInclude)("messages.yml", packager, scriptGenerator, langConfigurator));',
  '                taskManager.addTask((0, nsisLang_1.addCustomMessageFileInclude)("assistedMessages.yml", packager, scriptGenerator, langConfigurator));',
];

/** Pure transform: accept only exact known upstream or already-patched bytes. */
export function patchBuilderSource(bytes, version) {
  if (version !== BUILDER_VERSION || !(typeof bytes === "string" || bytes instanceof Uint8Array))
    throw new Error("Unsupported NSIS builder version or source");
  const original = Buffer.from(bytes), digest = hash(original);
  if (digest === BUILDER_PATCHED_SHA256) return { source: original, changed: false, evidence: evidence() };
  if (digest !== BUILDER_UPSTREAM_SHA256) throw new Error("Unrecognized NSIS builder source; review the dependency before packaging");
  let source = original.toString("utf8");
  for (const statement of statements) {
    if (source.split(statement).length !== 2) throw new Error("NSIS builder patch no longer matches exactly once");
    const serialized = statement.replace("taskManager.addTask(", "await ").replace(/\);$/, ";");
    source = source.replace(statement, serialized);
  }
  const result = Buffer.from(source, "utf8");
  if (hash(result) !== BUILDER_PATCHED_SHA256) throw new Error("NSIS builder patch digest mismatch");
  return { source: result, changed: true, evidence: evidence() };
}

async function installed() {
  const filename = require.resolve("app-builder-lib/out/targets/nsis/NsisTarget.js");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("NSIS builder source must be an ordinary installed file");
  const metadata = JSON.parse(await readFile(require.resolve("app-builder-lib/package.json"), "utf8"));
  return { filename, mode: info.mode & 0o777, bytes: await readFile(filename), version: metadata.version };
}

/** Read-only verifier: unpatched, differently patched and unknown versions fail. */
export async function readBuilderEvidence() {
  const item = await installed(), result = patchBuilderSource(item.bytes, item.version);
  if (result.changed) throw new Error("NSIS builder is not prepared; run the reviewed Windows packaging driver before verification");
  return result.evidence;
}

/** Called only by Windows packaging before recording provenance/loading builder. */
export async function prepareBuilder() {
  const item = await installed(), result = patchBuilderSource(item.bytes, item.version);
  if (result.changed) {
    const temporary = `${item.filename}.meetspace-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, result.source, { flag: "wx", mode: item.mode });
      await rename(temporary, item.filename);
    } finally { await rm(temporary, { force: true }); }
  }
  return readBuilderEvidence();
}
