const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, createHash } = require("node:crypto");
const digest = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

async function fixture(t) {
  const api = await import("../scripts/release-policy.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-readiness-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const keyPair = generateKeyPairSync("ed25519");
  const config = {
    schemaVersion: 1,
    licenseReviewed: true,
    signing: {
      mode: "pfx",
      certificateSha1: "A".repeat(40),
      timestampUrl: "https://timestamp.example.invalid/",
    },
    updateTrust: {
      schemaVersion: 1,
      enabled: true,
      appId: "com.janickiy.meetspace.desktop",
      channel: "stable",
      feedBaseUrl: "https://updates.example.invalid/meetspace/",
      publisherNames: ["CN=Fixture Publisher"],
      signingCertThumbprints: ["A".repeat(40)],
      manifestPublicKeys: [
        keyPair.publicKey.export({ type: "spki", format: "pem" }),
      ],
    },
  };
  const now = Date.parse("2026-10-14T12:00:00Z");
  const report = {
    schemaVersion: 1,
    version: "0.6.0",
    sourceCommit: "b".repeat(40),
    sourceTreeSha256: "c".repeat(64),
    sourceDirty: false,
    configSha256: api.releaseConfigSha256(config),
    artifacts: [],
    runtime: [],
  };
  for (const arch of ["x64", "arm64"]) {
    const file = `${arch}/MeetSpace-0.6.0-win-${arch}-setup.exe`,
      bytes = Buffer.from(
        `Synthetic ${arch} unit fixture; NOT a Windows binary.`,
      );
    await fs.mkdir(path.join(root, arch));
    await fs.writeFile(path.join(root, file), bytes);
    const signature = {
      path: "C:\\fixture\\MeetSpace.exe",
      status: "Valid",
      signatureType: "Authenticode",
      subject: "CN=Fixture Publisher",
      thumbprint: "A".repeat(40),
      timestamped: true,
    };
    report.artifacts.push({
      arch,
      file,
      size: bytes.length,
      sha256: digest(bytes),
      sha512: digest(bytes, "sha512", "base64"),
      embeddedPayloadVerified: true,
      payloadMachine: arch === "x64" ? "0x8664" : "0xaa64",
      releaseMode: "release",
      appId: config.updateTrust.appId,
      sourceDirty: false,
      sourceCommit: report.sourceCommit,
      sourceTreeSha256: report.sourceTreeSha256,
      signatures: { installer: { ...signature }, payload: { ...signature } },
      integrity: {
        embeddedResourceVerified: true,
        algorithm: "SHA256",
        headerSha256: "e".repeat(64),
        fuses: {
          runAsNode: false,
          nodeOptions: false,
          inspect: false,
          asarIntegrity: true,
          onlyLoadAsar: true,
        },
      },
    });
  }
  for (const target of ["win10-22h2-x64", "win11-x64", "win11-arm64"]) {
    const arch = target.endsWith("arm64") ? "arm64" : "x64";
    report.runtime.push({
      schemaVersion: 1,
      sourceCommit: report.sourceCommit,
      version: report.version,
      target,
      platform: "win32",
      osProductType: 1,
      osBuild: target.startsWith("win10") ? 19045 : 26100,
      osArchitecture: arch,
      processArchitecture: arch,
      nativeArchitectureVerified: true,
      installerSha256: report.artifacts.find((item) => item.arch === arch)
        .sha256,
      testBuild: false,
      result: "PASS",
      collectedAt: new Date(now).toISOString(),
      checks: Object.fromEntries(
        [
          "install",
          "launch",
          "singleInstance",
          "uninstall",
          "sandboxBridgeCsp",
          "protocol",
          "shortcuts",
          "noAutomaticStartup",
          "protocolShellLaunch",
          "manualProductAcceptance",
        ].map((check) => [check, true]),
      ),
    });
  }
  return {
    api,
    root,
    config,
    report,
    keyPair,
    options: { artifactRoot: root, config, now },
  };
}

test("readiness binds reviewed trust, exact bytes and all native signed Windows targets", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await f.api.validateReleaseReadiness(f.report, f.options),
    f.report,
  );
  // The positive unit fixture checks policy only, not real Authenticode/Windows.
  await fs.appendFile(
    path.join(f.root, f.report.artifacts[0].file),
    "tampered",
  );
  await assert.rejects(
    f.api.validateReleaseReadiness(f.report, f.options),
    /digest\/size/,
  );
});

test("readiness rejects unsigned, emulated, stale, partial and differently configured evidence", async (t) => {
  const f = await fixture(t);
  const mutations = [
    (r) => {
      r.sourceDirty = true;
    },
    (r) => {
      r.configSha256 = "d".repeat(64);
    },
    (r) => {
      r.artifacts[1].payloadMachine = "0x8664";
    },
    (r) => {
      r.artifacts[0].releaseMode = "test";
    },
    (r) => {
      r.artifacts[0].sourceTreeSha256 = "d".repeat(64);
    },
    (r) => {
      r.artifacts[0].signatures.installer.timestamped = false;
    },
    (r) => {
      r.artifacts[0].signatures.payload.status = "UnknownError";
    },
    (r) => {
      r.artifacts[0].signatures.installer.subject = "CN=Other";
    },
    (r) => {
      r.artifacts[0].signatures.installer.thumbprint = "E".repeat(40);
    },
    (r) => {
      r.artifacts[0].integrity.fuses.asarIntegrity = false;
    },
    (r) => {
      r.artifacts[0].integrity.fuses.runAsNode = true;
    },
    (r) => {
      delete r.artifacts[0].integrity;
    },
    (r) => {
      r.runtime.pop();
    },
    (r) => {
      r.runtime[2].testBuild = true;
    },
    (r) => {
      r.runtime[2].processArchitecture = "x64";
    },
    (r) => {
      r.runtime[1].osProductType = 3;
    },
    (r) => {
      r.runtime[0].osBuild = 19044;
    },
    (r) => {
      r.runtime[0].installerSha256 = "d".repeat(64);
    },
    (r) => {
      r.runtime[0].checks.protocolShellLaunch = false;
    },
    (r) => {
      r.runtime[0].collectedAt = "2020-01-01T00:00:00Z";
    },
    (r) => {
      r.artifacts[0].file = "../MeetSpace-0.6.0-win-x64-setup.exe";
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(f.report);
    mutate(invalid);
    await assert.rejects(
      f.api.validateReleaseReadiness(invalid, f.options),
      /Release blocked/,
    );
  }
});

test("configuration rejects unreviewed license, mutable trust, disabled feeds and private keys", async (t) => {
  const f = await fixture(t);
  for (const mutate of [
    (c) => {
      c.licenseReviewed = false;
    },
    (c) => {
      c.updateTrust.enabled = false;
    },
    (c) => {
      c.updateTrust.feedBaseUrl = "http://updates.example.invalid/";
    },
    (c) => {
      c.signing.timestampUrl = "https://u:p@timestamp.example.invalid/";
    },
    (c) => {
      c.signing.certificateSha1 = "F".repeat(40);
    },
    (c) => {
      c.updateTrust.publisherNames = [];
    },
    (c) => {
      c.updateTrust.manifestPublicKeys = [
        generateKeyPairSync("ed25519").privateKey.export({
          type: "pkcs8",
          format: "pem",
        }),
      ];
    },
    (c) => {
      c.updateTrust.manifestPublicKeys = [
        generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
          type: "spki",
          format: "pem",
        }),
      ];
    },
  ]) {
    const invalid = structuredClone(f.config);
    mutate(invalid);
    assert.throws(
      () => f.api.validateReleaseConfig(invalid),
      /Release blocked/,
    );
  }
});

test("manifest signing gates key access and round-trips an actual Ed25519 envelope", async (t) => {
  const f = await fixture(t);
  const { signReleaseManifest } =
    await import("../scripts/sign-update-manifest.mjs");
  const {
    parseUpdateTrust,
    verifyUpdateManifest,
  } = require("../dist/updates-policy.js");
  const privateKeyFile = path.join(f.root, "external-key.pem");
  const artifact = f.report.artifacts[1];
  const payload = {
    schemaVersion: 1,
    appId: f.config.updateTrust.appId,
    channel: "stable",
    arch: "arm64",
    version: f.report.version,
    publishedAt: new Date(f.options.now).toISOString(),
    expiresAt: new Date(f.options.now + 86400000).toISOString(),
    installer: {
      file: path.basename(artifact.file),
      size: artifact.size,
      sha512: artifact.sha512,
    },
  };
  const args = { ...f.options, report: f.report, payload, privateKeyFile };
  // This missing key would produce ENOENT if the key were touched before policy.
  await assert.rejects(
    signReleaseManifest({
      ...args,
      report: { ...f.report, sourceDirty: true },
    }),
    /Release blocked/,
  );
  await fs.writeFile(
    privateKeyFile,
    f.keyPair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  const signed = await signReleaseManifest(args);
  assert.deepEqual(
    verifyUpdateManifest(
      Buffer.from(JSON.stringify(signed)),
      parseUpdateTrust(f.config.updateTrust),
      "arm64",
      "0.5.0",
      f.options.now,
    ),
    payload,
  );
  await assert.rejects(
    signReleaseManifest({
      ...args,
      payload: {
        ...payload,
        installer: { ...payload.installer, size: payload.installer.size + 1 },
      },
    }),
    /release_payload_mismatch/,
  );
  await fs.writeFile(
    privateKeyFile,
    generateKeyPairSync("ed25519").privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
  );
  await assert.rejects(signReleaseManifest(args), /release_key_not_trusted/);
});
