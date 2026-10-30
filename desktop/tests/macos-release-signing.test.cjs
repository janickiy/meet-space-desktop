const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { X509Certificate } = require("node:crypto");

const teamId = "ABCDEFGHIJ";
async function config() {
  const certificate = new X509Certificate(await fs.readFile(path.join(__dirname, "fixtures/macos-signing-public-cert.pem")));
  return { schemaVersion: 1, licenseReviewed: true,
    signing: { teamId, certificateSha1: certificate.fingerprint.replaceAll(":", "") },
    notarization: { keychainProfile: "MeetSpaceNotaryCI" }, updateTrust: { schemaVersion: 1, enabled: false } };
}
const tools = () => import("../scripts/macos-signing.mjs");
const policy = () => import("../scripts/macos-release-policy.mjs");

test("Mac release configuration is public, exact, license-reviewed and cannot enable unaccepted updates", async () => {
  const { validateMacReleaseConfig, macReleaseConfigSha256 } = await policy();
  const value = await config();
  assert.deepEqual(validateMacReleaseConfig(value), value);
  assert.match(macReleaseConfigSha256(value), /^[a-f0-9]{64}$/);
  for (const change of [
    { licenseReviewed: false }, { applePassword: "SECRET" }, { schemaVersion: 2 },
    { signing: { ...value.signing, teamId: "../escape" } },
    { signing: { ...value.signing, certificateSha1: "Developer ID Application" } },
    { signing: { ...value.signing, p12Password: "SECRET" } },
    { notarization: { keychainProfile: "--password=SECRET" } },
    { notarization: { keychainProfile: "ok", password: "SECRET" } },
    { updateTrust: { schemaVersion: 1, enabled: true } },
  ]) assert.throws(() => validateMacReleaseConfig({ ...value, ...change }), /macOS release blocked/);
  assert.throws(() => validateMacReleaseConfig(require("../resources/macos/release-config.example.json")), /license/);
});

test("Mac config reader rejects symlinks, malformed JSON and oversized input without revealing contents", async t => {
  const { readMacReleaseConfig } = await policy();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-mac-config-"));
  try {
    const filename = path.join(temp, "reviewed.json");
    await fs.writeFile(filename, JSON.stringify(await config()));
    assert.deepEqual(await readMacReleaseConfig(filename), await config());
    await assert.rejects(readMacReleaseConfig("relative.json"));
    const link = path.join(temp, "alias.json");
    let linkCreated = false;
    try { await fs.symlink(filename, link); linkCreated = true; }
    catch (error) { if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error; t.diagnostic("Windows account cannot create a symlink fixture"); }
    if (linkCreated) await assert.rejects(readMacReleaseConfig(link), /ordinary file/);
    await fs.writeFile(filename, "SECRET_BAD_JSON");
    await assert.rejects(readMacReleaseConfig(filename), error => !error.message.includes("SECRET") && /valid JSON/.test(error.message));
    await fs.writeFile(filename, " ".repeat(32769));
    await assert.rejects(readMacReleaseConfig(filename), /ordinary file/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test("Mac release provenance accepts explicit beta/stable versions but only clean committed Mac source", async () => {
  const { makeMacBuildProvenance, macReleaseConfigSha256 } = await policy();
  const reviewed = await config(), inputs = { sourceDirty: false, sourceCommit: "a".repeat(40), sourceTreeSha256: "b".repeat(64) };
  const options = { pkg: { version: "0.2.1-beta" }, inputs, epoch: 1793114456, config: reviewed, hostPlatform: "darwin", hostArch: "arm64" };
  const proof = makeMacBuildProvenance(options);
  assert.equal(proof.buildVersion, "0.2.1-beta"); assert.equal(proof.appId, "com.janickiy.meetspace.desktop");
  assert.equal(proof.releaseConfigSha256, macReleaseConfigSha256(reviewed)); assert.equal(proof.sourceDirty, false);
  assert.equal(makeMacBuildProvenance({ ...options, pkg: { version: "1.2.3" } }).buildVersion, "1.2.3");
  for (const change of [{ inputs: { ...inputs, sourceDirty: true } }, { inputs: { ...inputs, sourceCommit: "unknown" } },
    { hostPlatform: "win32" }, { hostArch: "universal" }, { epoch: -1 }, { pkg: { version: "01.2.3" } }, { pkg: { version: "1.2.3-test" } }])
    assert.throws(() => makeMacBuildProvenance({ ...options, ...change }));
});

test("Hardened Runtime entitlements exclude broad executable memory and library-validation bypasses", async () => {
  const { MACOS_ENTITLEMENTS, macSigningBuilderOptions } = await policy();
  const { validateMacEntitlements } = await tools();
  const options = macSigningBuilderOptions(await config());
  assert.equal(options.hardenedRuntime, true); assert.equal(options.notarize, false);
  assert.equal(options.identity, (await config()).signing.certificateSha1);
  const plist = require("plist");
  for (const file of [options.entitlements, options.entitlementsInherit])
    assert.deepEqual(validateMacEntitlements(plist.parse(await fs.readFile(file, "utf8"))), MACOS_ENTITLEMENTS);
  for (const key of ["com.apple.security.get-task-allow", "com.apple.security.cs.disable-library-validation",
    "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.app-sandbox", "com.apple.developer.persistent-content-capture"])
    assert.throws(() => validateMacEntitlements({ ...MACOS_ENTITLEMENTS, [key]: true }), /unexpected signed entitlements/);
  assert.throws(() => validateMacEntitlements({ ...MACOS_ENTITLEMENTS, "com.apple.security.cs.allow-jit": false }));
});

function signature(config, identifier = "com.janickiy.meetspace.desktop") {
  return `Executable=/fixture/MeetSpace\nIdentifier=${identifier}\nCodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=1+7 location=embedded\nAuthority=Developer ID Application: Fixture Publisher (${config.signing.teamId})\nAuthority=Developer ID Certification Authority\nTeamIdentifier=${config.signing.teamId}\nTimestamp=Oct 28, 2026 at 12:00:00\n`;
}

async function nativeFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-mac-signing-"));
  const app = path.join(directory, "MeetSpace.app"), dmg = path.join(directory, "MeetSpace.dmg"), reviewed = await config();
  const { MACOS_MEDIA_USAGE_DESCRIPTIONS } = await import("../scripts/macos-package-policy.mjs");
  const header = Buffer.alloc(32); header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(0x0100000c, 4);
  const writeBinary = async relative => { const filename = path.join(app, relative); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, header); };
  await writeBinary("Contents/MacOS/MeetSpace");
  await writeBinary("Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework");
  for (const name of ["MeetSpace Helper", "MeetSpace Helper (GPU)", "MeetSpace Helper (Renderer)"])
    await writeBinary(`Contents/Frameworks/${name}.app/Contents/MacOS/${name}`);
  await fs.writeFile(dmg, "fixture-dmg-not-real");
  const certificate = new X509Certificate(await fs.readFile(path.join(__dirname, "fixtures/macos-signing-public-cert.pem")));
  const plist = { CFBundleIdentifier: "com.janickiy.meetspace.desktop", CFBundleExecutable: "MeetSpace", CFBundleDisplayName: "MeetSpace",
    CFBundleShortVersionString: "0.2.1-beta", LSMinimumSystemVersion: "15.0", ...MACOS_MEDIA_USAGE_DESCRIPTIONS };
  const calls = [], state = { notaryStatus: "Accepted", signature: signature(reviewed), failedCommand: null, gatekeeperAccepted: true };
  const entitlements = await fs.readFile(path.join(__dirname, "../resources/macos/entitlements.main.plist"), "utf8");
  async function run(file, args, options) {
    calls.push({ file, args: [...args], options });
    if (state.failedCommand && (file + " " + args.join(" ")).includes(state.failedCommand))
      return { status: 1, stdout: "SECRET_ACCOUNT_DIAGNOSTIC", stderr: "SECRET_PASSWORD" };
    if (file === "/usr/bin/security") return { status: 0, stdout: `  1) ${reviewed.signing.certificateSha1} "Developer ID Application: Fixture Publisher (${reviewed.signing.teamId})"\n     1 valid identities found\n`, stderr: "" };
    if (file === "/usr/bin/plutil") return { status: 0, stdout: JSON.stringify(plist), stderr: "" };
    if (file === "/usr/bin/codesign" && args.includes("--extract-certificates")) await fs.writeFile(args[args.indexOf("--extract-certificates") + 1] + "0", certificate.raw);
    if (file === "/usr/bin/codesign" && args.includes("--entitlements")) return { status: 0, stdout: entitlements, stderr: "" };
    if (file === "/usr/bin/codesign" && args.includes("--verbose=4")) return { status: 0, stdout: "", stderr: state.signature };
    if (file === "/usr/bin/xcrun" && args[0] === "notarytool") return { status: 0, stdout: JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", status: state.notaryStatus }), stderr: "" };
    if (file === "/usr/sbin/spctl") return { status: 0, stdout: "", stderr: `${dmg}: ${state.gatekeeperAccepted ? "accepted" : "rejected"}\nsource=${state.gatekeeperAccepted ? "Notarized Developer ID" : "Unnotarized Developer ID"}\n` };
    return { status: 0, stdout: "", stderr: "" };
  }
  return { directory, app, dmg, config: reviewed, run, calls, state, plist,
    options: { config: reviewed, run, platform: "darwin", keychainPath: path.join(directory, "ci.keychain-db") },
    close: () => fs.rm(directory, { recursive: true, force: true }) };
}

test("Developer ID selection and signed evidence reject wrong Team, ad-hoc, missing runtime or timestamp", async () => {
  const { verifyMacSigningIdentity, validateMacSignatureDetails } = await tools();
  const f = await nativeFixture();
  try {
    assert.equal((await verifyMacSigningIdentity(f.options)).identityAvailable, true);
    validateMacSignatureDetails(signature(f.config), f.config, { identifier: "com.janickiy.meetspace.desktop" });
    for (const text of [signature(f.config).replace(teamId, "ZZZZZZZZZZ"), signature(f.config).replace("0x10000(runtime)", "0x0(none)"),
      signature(f.config).replace(/^Timestamp=.*\n/m, ""), signature(f.config).replace(/^Timestamp=.*$/m, "Timestamp=none"),
      signature(f.config).replace("Developer ID Application:", "Apple Development:")])
      assert.throws(() => validateMacSignatureDetails(text, f.config));
    const before = f.calls.length;
    await assert.rejects(verifyMacSigningIdentity({ ...f.options, platform: "linux" }), /require macOS/);
    assert.equal(f.calls.length, before, "non-Mac hosts never invoke native tools");
  } finally { await f.close(); }
});

test("signed app verification binds actual thin binaries, helpers, entitlements and extracted leaf certificate", async () => {
  const { verifyMacSignature } = await tools();
  const f = await nativeFixture();
  try {
    const result = await verifyMacSignature({ ...f.options, app: f.app, arch: "arm64", version: "0.2.1-beta" });
    assert.equal(result.signed, true); assert.equal(result.deepVerification, true); assert.equal(result.helpers.length, 3);
    assert.equal(result.binaries.length, 5, "all physical main/framework/helper binaries verified");
    assert.equal(result.certificateSha1, f.config.signing.certificateSha1); assert.equal(result.nativeRuntimeTested, false);
    await assert.rejects(verifyMacSignature({ ...f.options, app: f.app, arch: "x64" }), /Wrong Mach-O/);
    await assert.rejects(verifyMacSignature({ ...f.options, app: f.app, arch: "arm64", version: "9.9.9" }), /metadata mismatch/);
    const foreign = path.join(f.app, "Contents/Frameworks/foreign.dylib"), foreignHeader = Buffer.alloc(32);
    foreignHeader.writeUInt32LE(0xfeedface); await fs.writeFile(foreign, foreignHeader);
    await assert.rejects(verifyMacSignature({ ...f.options, app: f.app, arch: "arm64" }), /thin 64-bit Mach-O/);
    await fs.rm(foreign);
    f.config.signing.certificateSha1 = "F".repeat(40);
    await assert.rejects(verifyMacSignature({ ...f.options, app: f.app, arch: "arm64" }), /certificate fingerprint/);
  } finally { await f.close(); }
});

test("app notarization uploads a ZIP, staples the app and requires Accepted plus actual Gatekeeper evidence", async () => {
  const { notarizeMacArtifact } = await tools();
  const f = await nativeFixture();
  try {
    const result = await notarizeMacArtifact({ ...f.options, artifact: f.app, kind: "app" });
    assert.equal(result.notarization, "Accepted"); assert.equal(result.stapleValidated, true); assert.equal(result.gatekeeperAccepted, true);
    assert.ok(f.calls.some(call => call.file === "/usr/bin/ditto" && call.args.includes("--keepParent")));
    const submit = f.calls.find(call => call.args[0] === "notarytool");
    assert.ok(submit.args[2].endsWith(".zip")); assert.ok(submit.args.includes("--wait"));
    assert.ok(submit.args.includes(f.options.keychainPath)); assert.ok(submit.args.includes("MeetSpaceNotaryCI"));
    await assert.rejects(fs.lstat(path.dirname(submit.args[2])), { code: "ENOENT" });
    assert.ok(f.calls.some(call => call.args[0] === "stapler" && call.args[1] === "validate"));
    assert.ok(f.calls.some(call => call.file === "/usr/sbin/spctl" && call.args.includes("execute")));
    f.state.notaryStatus = "Invalid"; const before = f.calls.length;
    await assert.rejects(notarizeMacArtifact({ ...f.options, artifact: f.app, kind: "app" }), /not accepted/);
    assert.equal(f.calls.slice(before).some(call => call.args[0] === "stapler"), false);
    f.state.notaryStatus = "Accepted"; f.state.gatekeeperAccepted = false;
    await assert.rejects(notarizeMacArtifact({ ...f.options, artifact: f.app, kind: "app" }), /Gatekeeper/);
  } finally { await f.close(); }
});

test("DMG is explicitly signed with the pinned identity, notarized separately and never assessed as executable", async () => {
  const { signMacDmg, notarizeMacArtifact } = await tools();
  const f = await nativeFixture();
  try {
    await signMacDmg({ ...f.options, dmg: f.dmg });
    const call = f.calls.find(call => call.file === "/usr/bin/codesign" && call.args.includes("--sign"));
    assert.ok(call.args.includes(f.config.signing.certificateSha1)); assert.ok(call.args.includes("--timestamp"));
    const result = await notarizeMacArtifact({ ...f.options, artifact: f.dmg, kind: "dmg" });
    assert.equal(result.kind, "dmg"); assert.equal(result.stapled, true);
    assert.ok(f.calls.some(call => call.file === "/usr/sbin/spctl" && call.args.includes("context:primary-signature") && call.args.includes("open")));
    f.state.failedCommand = "notarytool";
    await assert.rejects(notarizeMacArtifact({ ...f.options, artifact: f.dmg, kind: "dmg" }), error =>
      !error.message.includes("SECRET") && /native signing or notarization command failed/.test(error.message));
    assert.equal(f.calls.some(call => call.file.includes("sh")), false, "commands never execute through a shell");
  } finally { await f.close(); }
});
