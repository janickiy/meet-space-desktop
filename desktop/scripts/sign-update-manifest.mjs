// Offline signing only. Publication is a separate, reviewed release action.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateReleaseConfig, validateReleaseReadiness } from "./release-policy.mjs";
const require = createRequire(import.meta.url);
const { parseUpdateTrust, validateUpdatePayload, canonicalizeUpdatePayload, updateKeyId } = require("../dist/updates-policy.js");
const repository = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export async function signReleaseManifest({ config: rawConfig, report, payload, artifactRoot, privateKeyFile, now = Date.now() }) {
  const config = validateReleaseConfig(rawConfig), trust = parseUpdateTrust(config.updateTrust);
  if (!trust) throw new Error("release_trust_required");
  // No key is opened before the complete signing, architecture and real Windows
  // acceptance evidence has passed the independent release gate.
  const readiness = await validateReleaseReadiness(report, { artifactRoot, config, now });
  const value = validateUpdatePayload(payload, trust, payload?.arch, now);
  const artifact = readiness.artifacts.find(item => item.arch === value.arch);
  if (!artifact || value.version !== readiness.version || path.basename(artifact.file) !== value.installer.file ||
    value.installer.size !== artifact.size || value.installer.sha512 !== artifact.sha512) throw new Error("release_payload_mismatch");
  const filename = await realpath(privateKeyFile), checkout = await realpath(repository);
  if (filename === checkout || filename.startsWith(checkout + path.sep)) throw new Error("release_key_in_repository");
  const info = await lstat(filename);
  if (!info.isFile() || info.size > 8192) throw new Error("release_key_invalid");
  const bytes = await readFile(filename);
  try {
    const privateKey = createPrivateKey(bytes);
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("release_key_invalid");
    const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    const keyId = updateKeyId(publicKey);
    if (!trust.manifestPublicKeys.some(key => updateKeyId(key) === keyId)) throw new Error("release_key_not_trusted");
    const canonical = canonicalizeUpdatePayload(value);
    return { schemaVersion: 1, keyId, payload: canonical.toString("base64"), signature: sign(null, canonical, privateKey).toString("base64") };
  } finally { bytes.fill(0); }
}

async function main() {
  const names = ["--config", "--readiness", "--payload", "--artifact-root", "--key-file", "--output"], args = process.argv.slice(2), input = {};
  if (args.length !== names.length * 2) throw new Error("release_arguments_invalid");
  for (let n = 0; n < args.length; n += 2) {
    if (!names.includes(args[n]) || Object.hasOwn(input, args[n]) || !args[n + 1]) throw new Error("release_arguments_invalid");
    input[args[n]] = args[n + 1];
  }
  const json = async name => {
    const info = await lstat(input[name]);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error("release_input_invalid");
    return JSON.parse(await readFile(input[name], "utf8"));
  };
  const config = await json("--config"), report = await json("--readiness"), payload = await json("--payload");
  const envelope = await signReleaseManifest({ config, report, payload, artifactRoot: input["--artifact-root"], privateKeyFile: input["--key-file"] });
  await writeFile(input["--output"], JSON.stringify(envelope, null, 2) + "\n", { flag: "wx", mode: 0o644 });
  console.log("Signed update manifest created locally. Nothing was published.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => {
  console.error("Manifest signing refused. Check the reviewed release configuration, artifact and Windows acceptance reports, and trusted external key.");
  process.exitCode = 1;
});
