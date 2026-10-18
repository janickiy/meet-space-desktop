"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createLinuxAutostart } = require("../dist/platform/autostart.js");

const posix = typeof process.getuid === "function";
const id = "com.janickiy.meetspace.desktop.test";
function fixture(name = "MeetSpace") {
  // Executable fixtures must be persistent-location candidates, not /tmp launchers.
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), ".meetspace-autostart-test-"));
  const home = path.join(directory, "home");
  fs.mkdirSync(home, { mode: 0o700 });
  const executable = path.join(directory, name);
  fs.writeFileSync(executable, '#!/bin/sh\nprintf "ARGC=%s\\n" "$#" > "$0.result"\n', { mode: 0o700 });
  const options = { packaged: true, appId: id, execPath: executable, homeDir: home, env: {}, uid: process.getuid() };
  const provider = createLinuxAutostart(options);
  const filename = path.join(home, ".config/autostart", `${id}.desktop`);
  return { directory, home, executable, filename, options, provider,
    read: () => fs.readFileSync(filename, "utf8"),
    prepare() { fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 }); },
    dispose() { fs.rmSync(directory, { recursive: true, force: true }); } };
}
function check(name, fn) {
  test(name, { skip: !posix }, async () => { const value = fixture(); try { await fn(value); } finally { value.dispose(); } });
}

test("unpackaged and unsupported identities never create autostart files", () => {
  const provider = createLinuxAutostart({ packaged: false, appId: id, execPath: process.execPath, env: {}, homeDir: os.homedir(), uid: 0 });
  assert.deepEqual(provider.status(), { supported: false, enabled: false, reason: "unpackaged" });
  assert.throws(() => provider.setEnabled(true), /startup_unavailable/);
});

check("construction/status are read-only and explicit opt-in is reversible/idempotent", value => {
  assert.deepEqual(value.provider.status(), { supported: true, enabled: false });
  assert.equal(fs.existsSync(path.join(value.home, ".config")), false);
  value.provider.setEnabled(true);
  assert.deepEqual(value.provider.status(), { supported: true, enabled: true });
  assert.match(value.read(), /Hidden=false\n/);
  assert.equal(fs.statSync(value.filename).mode & 0o777, 0o600);
  const original = value.read();
  value.provider.setEnabled(true);
  assert.equal(value.read(), original);
  value.provider.setEnabled(false);
  assert.deepEqual(value.provider.status(), { supported: true, enabled: false });
  assert.equal(value.read(), original.replace("Hidden=false", "Hidden=true"));
  assert.equal(value.read().includes("\0"), false, "updates write at offset zero after reading the same fd");
  value.provider.setEnabled(true);
  assert.equal(value.read(), original);
  assert.deepEqual(fs.readdirSync(path.dirname(value.filename)), [`${id}.desktop`]);
});

check("explicit opt-out keeps a Hidden=true user override rather than exposing system autostart", value => {
  value.provider.setEnabled(false);
  assert.match(value.read(), /Hidden=true\n/);
  const before = value.read();
  value.provider.setEnabled(false);
  assert.equal(value.read(), before);
});

check("absolute XDG_CONFIG_HOME is honoured and relative/empty values use the home default", value => {
  for (const configured of ["", "relative/config"]) {
    const provider = createLinuxAutostart({ ...value.options, env: { XDG_CONFIG_HOME: configured } });
    provider.setEnabled(true);
    assert.equal(provider.status().enabled, true);
  }
  const config = path.join(value.directory, "custom config");
  const provider = createLinuxAutostart({ ...value.options, env: { XDG_CONFIG_HOME: config } });
  assert.equal(provider.status().enabled, false);
  assert.equal(fs.existsSync(config), false);
  provider.setEnabled(true);
  assert.ok(fs.existsSync(path.join(config, "autostart", `${id}.desktop`)));
});

check("regular packaged executables use exact validated identity without guessing deb/rpm", value => {
  assert.deepEqual(createLinuxAutostart({ ...value.options, appId: "foreign.app" }).status(), { supported: false, enabled: false, reason: "unavailable" });
  assert.deepEqual(createLinuxAutostart({ ...value.options, execPath: "/tmp/MeetSpace" }).status(), { supported: false, enabled: false, reason: "unavailable" });
  for (const invalid of ["/run/user/1000/MeetSpace", "/var/tmp/MeetSpace", "/dev/fd/3", "relative/MeetSpace", "/opt/name=arg", "/opt/name\nExec=evil"]) {
    const provider = createLinuxAutostart({ ...value.options, execPath: invalid });
    assert.equal(provider.status().supported, false);
    assert.throws(() => provider.setEnabled(true), /startup_unavailable|preferences_unavailable/);
  }
  const percent = path.join(value.directory, "MeetSpace%literal");
  fs.copyFileSync(value.executable, percent);
  const unsupported = createLinuxAutostart({ ...value.options, execPath: percent });
  assert.deepEqual(unsupported.status(), { supported: false, enabled: false, reason: "unavailable" });
  assert.throws(() => unsupported.setEnabled(true), /startup_unavailable/);
  assert.equal(fs.existsSync(value.filename), false);
});

check("AppImage uses original absolute APPIMAGE and rejects inconsistent/missing mount evidence", value => {
  const mount = path.join(value.directory, "app mount");
  fs.mkdirSync(mount, { mode: 0o700 });
  const current = path.join(mount, "MeetSpace");
  fs.copyFileSync(value.executable, current);
  const env = { APPIMAGE: value.executable, APPDIR: mount };
  const provider = createLinuxAutostart({ ...value.options, execPath: current, env });
  provider.setEnabled(true);
  assert.ok(value.read().includes(`Exec="${value.executable}"\n`));
  assert.equal(provider.status().enabled, true);
  for (const invalid of [{ APPIMAGE: value.executable }, { APPDIR: mount }, { APPIMAGE: "relative.AppImage", APPDIR: mount }, { APPIMAGE: value.executable, APPDIR: value.home }])
    assert.equal(createLinuxAutostart({ ...value.options, execPath: current, env: invalid }).status().supported, false);
  fs.unlinkSync(value.executable);
  assert.equal(provider.status().supported, false, "a moved/deleted original image is never replaced by its transient mount executable");
});

check("changed executable location is not silently registered; opt-out preserves the old owned target", value => {
  value.provider.setEnabled(true);
  const other = path.join(value.directory, "MeetSpace updated");
  fs.copyFileSync(value.executable, other);
  const provider = createLinuxAutostart({ ...value.options, execPath: other });
  assert.deepEqual(provider.status(), { supported: true, enabled: false });
  provider.setEnabled(false);
  assert.ok(value.read().includes(`Exec="${value.executable}"\n`));
  assert.match(value.read(), /Hidden=true/);
});

check("foreign or edited files are never adopted, overwritten or deleted", value => {
  value.prepare();
  for (const content of ["foreign\n", "[Desktop Entry]\nExec=/bin/true\n", "x".repeat(9000)]) {
    fs.writeFileSync(value.filename, content, { mode: 0o600 });
    assert.deepEqual(value.provider.status(), { supported: false, enabled: false, reason: "conflict" });
    for (const enabled of [true, false]) assert.throws(() => value.provider.setEnabled(enabled), /startup_conflict/);
    assert.equal(value.read(), content);
  }
  fs.unlinkSync(value.filename);
  value.provider.setEnabled(true);
  const edited = value.read() + "X-Foreign-Setting=true\n";
  fs.writeFileSync(value.filename, edited);
  assert.throws(() => value.provider.setEnabled(false), /startup_conflict/);
  assert.equal(value.read(), edited);
});

check("symlink, directory and hardlink targets remain untouched", value => {
  value.prepare();
  const unrelated = path.join(value.directory, "unrelated");
  fs.writeFileSync(unrelated, "unchanged", { mode: 0o600 });
  for (const make of [() => fs.symlinkSync(unrelated, value.filename), () => fs.linkSync(unrelated, value.filename), () => fs.mkdirSync(value.filename)]) {
    make();
    assert.equal(value.provider.status().reason, "conflict");
    assert.throws(() => value.provider.setEnabled(true), /startup_conflict/);
    assert.equal(fs.readFileSync(unrelated, "utf8"), "unchanged");
    fs.rmSync(value.filename, { recursive: true, force: true });
  }
});

check("symlink configuration parents and writable executable ancestors fail closed", value => {
  const other = path.join(value.directory, "other-config");
  fs.mkdirSync(other, { mode: 0o700 });
  fs.symlinkSync(other, path.join(value.home, ".config"));
  assert.equal(value.provider.status().supported, false);
  assert.throws(() => value.provider.setEnabled(true), /startup_unavailable/);
  assert.deepEqual(fs.readdirSync(other), []);
  fs.unlinkSync(path.join(value.home, ".config"));
  fs.chmodSync(value.directory, 0o777);
  assert.equal(value.provider.status().supported, false);
  fs.chmodSync(value.directory, 0o700);
});

check("unsafe config permissions and files masquerading as this product are conflicts", value => {
  value.provider.setEnabled(true);
  const owned = value.read();
  fs.writeFileSync(value.filename, owned.replace('Exec="', 'Exec="/bin/true" --argument "'));
  assert.equal(value.provider.status().reason, "conflict");
  assert.throws(() => value.provider.setEnabled(false), /startup_conflict/);
  fs.writeFileSync(value.filename, owned);
  fs.chmodSync(path.dirname(value.filename), 0o777);
  assert.equal(value.provider.status().reason, "unavailable");
  assert.throws(() => value.provider.setEnabled(false), /startup_unavailable/);
  assert.equal(value.read(), owned);
  fs.chmodSync(path.dirname(value.filename), 0o700);
});

check("replacement during an owned-file update cannot overwrite the foreign replacement", value => {
  value.provider.setEnabled(true);
  const original = fs.ftruncateSync;
  let replaced = false;
  fs.ftruncateSync = (fd, size) => {
    if (!replaced) {
      replaced = true;
      fs.renameSync(value.filename, `${value.filename}.owned`);
      fs.writeFileSync(value.filename, "foreign replacement", { mode: 0o600 });
    }
    return original(fd, size);
  };
  try { assert.throws(() => value.provider.setEnabled(false), /startup_conflict/); }
  finally { fs.ftruncateSync = original; }
  assert.equal(value.read(), "foreign replacement");
});

check("directory replacement during an update cannot redirect writes to the new autostart directory", value => {
  value.provider.setEnabled(true);
  const original = fs.ftruncateSync;
  let replaced = false;
  fs.ftruncateSync = (fd, size) => {
    if (!replaced) {
      replaced = true;
      fs.renameSync(path.dirname(value.filename), `${path.dirname(value.filename)}.owned`);
      fs.mkdirSync(path.dirname(value.filename), { mode: 0o700 });
      fs.writeFileSync(value.filename, "foreign directory entry", { mode: 0o600 });
    }
    return original(fd, size);
  };
  try { assert.throws(() => value.provider.setEnabled(false), /startup_conflict/); }
  finally { fs.ftruncateSync = original; }
  assert.equal(value.read(), "foreign directory entry");
  assert.match(fs.readFileSync(path.join(`${path.dirname(value.filename)}.owned`, `${id}.desktop`), "utf8"), /Hidden=true/);
});

check("a file that grows after inspection is read only within the fixed bound", value => {
  value.provider.setEnabled(true);
  const original = fs.readSync;
  let grown = false;
  let maximumRead = 0;
  fs.readSync = (fd, buffer, offset, length, position) => {
    maximumRead = Math.max(maximumRead, length);
    if (!grown) { grown = true; fs.appendFileSync(value.filename, "x".repeat(16000)); }
    return original(fd, buffer, offset, length, position);
  };
  try { assert.equal(value.provider.status().reason, "conflict"); }
  finally { fs.readSync = original; }
  assert.equal(grown, true);
  assert.ok(maximumRead <= 8193);
});

check("exclusive creation refuses a file installed after the absence check", value => {
  value.prepare();
  const original = fs.openSync;
  let replaced = false;
  fs.openSync = (filename, flags, ...rest) => {
    if (!replaced && typeof filename === "string" && filename.endsWith(`${id}.desktop`) && (flags & fs.constants.O_EXCL)) {
      replaced = true;
      fs.writeFileSync(value.filename, "late foreign file", { mode: 0o600 });
    }
    return original(filename, flags, ...rest);
  };
  try { assert.throws(() => value.provider.setEnabled(true), /startup_conflict/); }
  finally { fs.openSync = original; }
  assert.equal(value.read(), "late foreign file");
});

test("Desktop Entry quoting launches one exact harmless path through real GIO", { skip: !posix || process.platform !== "linux" || !fs.existsSync("/usr/bin/gio") }, async () => {
  const value = fixture('Meet Space "quote" $dollar `tick` \\slash Кириллица');
  try {
    value.provider.setEnabled(true);
    const result = spawnSync("/usr/bin/gio", ["launch", value.filename], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    const output = `${value.executable}.result`;
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(fs.readFileSync(output, "utf8"), "ARGC=0\n");
    assert.equal(value.provider.status().enabled, true);
  } finally { value.dispose(); }
});
