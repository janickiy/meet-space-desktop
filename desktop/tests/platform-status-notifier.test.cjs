"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { statusNotifierRegistered, LinuxStatusNotifierMonitor } = require("../dist/platform/status-notifier");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function bus(overrides = {}) {
  const calls = [];
  const query = async args => {
    calls.push(args);
    if (overrides.error) throw new Error("not on the session bus");
    if (args[0] === "get-property") {
      if (args.at(-1) === "IsStatusNotifierHostRegistered") return overrides.host ?? { type: "b", data: true };
      return overrides.items ?? { type: "as", data: [":1.88/StatusNotifierItem"] };
    }
    if (args[4] === "GetNameOwner") {
      const name = args.at(-1);
      if (name === "org.gnome.Shell") {
        if (overrides.gnomeOwner === null) throw new Error("no GNOME Shell on KDE");
        return { type: "s", data: [overrides.gnomeOwner ?? ":1.20"] };
      }
      if (name.startsWith("org.kde.StatusNotifierHost-")) {
        if (overrides.hostOwner === null) throw new Error("host vanished");
        return { type: "s", data: [overrides.hostOwner?.() ?? ":1.50"] };
      }
      return { type: "s", data: [overrides.owner?.() ?? ":1.20"] };
    }
    if (args[4] === "ListNames") return overrides.names ?? { type: "as", data: [overrides.hostNames ?? []] };
    if (args[4] === "GetConnectionUnixProcessID") return { type: "u", data: [overrides.pid ?? 321] };
    throw new Error("unexpected D-Bus request");
  };
  return { query, calls };
}
test("tray needs both host and own PID item, not only an existing watcher", async () => {
  for (const [options, expected] of [[{}, true], [{ host: { type: "b", data: false } }, false],
    [{ pid: 987 }, false], [{ items: { type: "as", data: [] } }, false], [{ error: true }, false]]) {
    const value = bus(options);
    assert.equal(await statusNotifierRegistered(value.query, 321, new AbortController().signal), expected);
  }
});
test("busctl method scalars and flat property arrays are decoded without shell parsing", async () => {
  const value = bus({ items: { type: "as", data: ["invalid/path-with-dash", ":1.88/org/ayatana/NotificationItem/MeetSpace"] } });
  assert.equal(await statusNotifierRegistered(value.query, 321, new AbortController().signal), true);
  assert.equal(value.calls.filter(args => args[4] === "GetConnectionUnixProcessID").length, 1);
  assert.equal(value.calls.find(args => args[4] === "GetConnectionUnixProcessID").at(-1), ":1.88");
});
test("malformed, oversized and foreign property replies fail closed", async () => {
  for (const options of [{ host: { type: "s", data: "true" } }, { items: { type: "as", data: [[":1.88/StatusNotifierItem"]] } },
    { items: { type: "as", data: Array(65).fill(":1.88/StatusNotifierItem") } }, { items: { type: "as", data: ["$(touch /tmp/nope)"] } },
    { items: { type: "as", data: [":1.88/../../private"] } }, { items: { type: "s", data: ":1.88/StatusNotifierItem" } }])
    assert.equal(await statusNotifierRegistered(bus(options).query, 321, new AbortController().signal), false);
});
test("watcher replacement invalidates a mixed snapshot and aborted probes cannot grant", async () => {
  let ownerCount = 0;
  const value = bus({ owner: () => ++ownerCount === 1 ? ":1.20" : ":1.21" });
  assert.equal(await statusNotifierRegistered(value.query, 321, new AbortController().signal), false);
  const abort = new AbortController(); abort.abort();
  assert.equal(await statusNotifierRegistered(bus().query, 321, abort.signal), false);
  const lateAbort = new AbortController();
  let watcherReads = 0;
  const normal = bus().query;
  const delayed = async args => {
    const value = await normal(args);
    if (args[4] === "GetNameOwner" && args.at(-1) === "org.kde.StatusNotifierWatcher" && ++watcherReads === 2) lateAbort.abort();
    return value;
  };
  assert.equal(await statusNotifierRegistered(delayed, 321, lateAbort.signal), false);
});

test("KDE watcher true property is insufficient after the real panel host disappears", async () => {
  const hostNames = ["org.kde.StatusNotifierHost-456"];
  for (const [options, expected] of [[{ gnomeOwner: null }, false], [{ gnomeOwner: ":1.99" }, false],
    [{ gnomeOwner: null, hostNames }, true], [{ gnomeOwner: null, hostNames, hostOwner: null }, false],
    [{ gnomeOwner: null, names: { type: "as", data: hostNames } }, false]])
    assert.equal(await statusNotifierRegistered(bus(options).query, 321, new AbortController().signal), expected);
  let hostReads = 0;
  assert.equal(await statusNotifierRegistered(bus({ gnomeOwner: null, hostNames,
    hostOwner: () => ++hostReads === 1 ? ":1.50" : ":1.51" }).query, 321, new AbortController().signal), false);
});
test("monitor publishes registration/loss and stops its own polling and late replies", async () => {
  let owned = true, queries = 0;
  const changes = [];
  const monitor = new LinuxStatusNotifierMonitor({ pid: 321, intervalMs: 5, query: async args => {
    queries++; return bus(owned ? {} : { error: true }).query(args);
  } });
  assert.equal(monitor.available(), false);
  monitor.start(value => changes.push(value));
  await pause(10);
  assert.equal(monitor.available(), true);
  owned = false;
  await pause(15);
  assert.equal(monitor.available(), false);
  assert.deepEqual(changes, [true, false]);
  monitor.dispose();
  const stopped = queries;
  await pause(15);
  assert.equal(queries, stopped);
  let resolve;
  const delayed = new LinuxStatusNotifierMonitor({ pid: 321, query: () => new Promise(value => { resolve = value; }) });
  delayed.start(() => { throw new Error("late availability after disposal"); });
  delayed.dispose(); resolve({ type: "s", data: [":1.20"] });
  await pause(1);
  assert.equal(delayed.available(), false);
});

test("a hanging probe cannot strand availability, a late grant is ignored, and callback errors do not stop recovery", async () => {
  let hang = false, late;
  const changes = [];
  const monitor = new LinuxStatusNotifierMonitor({ pid: 321, intervalMs: 5, deadlineMs: 8,
    query: args => hang ? new Promise(resolve => { late = resolve; }) : bus().query(args) });
  monitor.start(value => { changes.push(value); if (value) throw new Error("menu was closing"); });
  await pause(2);
  assert.equal(monitor.available(), true);
  hang = true;
  await pause(17);
  assert.equal(monitor.available(), false, "hard monitor deadline publishes loss even for a query ignoring abort");
  assert.deepEqual(changes.slice(0, 2), [true, false]);
  const pending = late;
  hang = false;
  pending({ type: "s", data: [":1.20"] });
  await pause(25);
  assert.equal(monitor.available(), true, "a fresh independent probe recovers after callback failure");
  monitor.dispose();
  assert.equal(monitor.available(), false);
});
