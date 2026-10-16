import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function compile(entry, desktop = true, append = "") {
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    define: { __DESKTOP_BUILD__: JSON.stringify(desktop) },
    plugins: [
      {
        name: "lifecycle-test-exports",
        transform(code, id) {
          if (id === resolve(root, entry)) return code + "\n" + append;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(root, entry), formats: ["es"] },
    },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  const chunk = output.find((item) => item.type === "chunk" && item.isEntry);
  return import(
    "data:text/javascript;base64," + Buffer.from(chunk.code).toString("base64")
  );
}

// Test-only device/RTCPeerConnection stand-ins expose delayed browser operations.
// Production code is compiled unchanged and driven through its actual public API.
class Track extends EventTarget {
  constructor(kind) {
    super();
    this.kind = kind;
    this.id = randomUUID();
    this.readyState = "live";
    this.enabled = true;
    this.onended = null;
    this.stops = 0;
  }
  stop() {
    this.readyState = "ended";
    this.stops++;
  }
  unplug() {
    this.readyState = "ended";
    this.onended?.();
    this.dispatchEvent(new Event("ended"));
  }
  async applyConstraints() {}
}
class Stream {
  constructor(tracks = []) {
    this.id = randomUUID();
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
  addTrack(track) {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
  removeTrack(track) {
    this.tracks = this.tracks.filter((item) => item !== track);
  }
}
class Peer {
  static all = [];
  constructor(options) {
    this.options = options;
    this.transceivers = [];
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.signalingState = "stable";
    Peer.all.push(this);
  }
  addTransceiver(input, options) {
    const track = typeof input === "string" ? null : input;
    const transceiver = {
      mid: String(this.transceivers.length),
      direction: options.direction,
      sender: {
        track,
        replaceTrack: async function (next) {
          this.track = next;
        },
      },
      receiver: { track: new Track(track?.kind ?? input) },
      setCodecPreferences() {},
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() {
    return this.transceivers;
  }
  getReceivers() {
    return this.transceivers.map((item) => item.receiver);
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" };
  }
  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState =
      description.type === "rollback" ? "stable" : "have-local-offer";
  }
  async setRemoteDescription() {
    this.signalingState = "stable";
  }
  async addIceCandidate() {}
  close() {
    this.connectionState = "closed";
    this.closed = true;
  }
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function install(
  capture = async () => new Stream([new Track("audio"), new Track("video")]),
) {
  globalThis.MediaStream = Stream;
  globalThis.RTCPeerConnection = Peer;
  globalThis.RTCRtpReceiver = { getCapabilities: () => ({ codecs: [] }) };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: capture,
        getDisplayMedia: async () =>
          new Stream([new Track("video"), new Track("audio")]),
      },
    },
  });
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: () => null, setItem() {} };
}
const { ConferenceMediaClient } = await compile("src/media.ts");
async function joined({ capture = true, options, sendError } = {}) {
  const commands = [];
  const client = new ConferenceMediaClient(
    (type, data) => {
      if (sendError?.(type)) throw new Error("fixture signalling disconnected");
      const id = randomUUID();
      commands.push({ type, data, id });
      return id;
    },
    () => {},
  );
  await client.start(capture, options);
  const join = commands.find((command) => command.type === "media.join");
  assert.ok(join, "client sends native-independent existing media.join");
  const peerID = randomUUID();
  client.handle({
    type: "media.joined",
    replyTo: join.id,
    data: {
      mediaPeerId: peerID,
      workerId: "fixture",
      maxPeers: 2,
      tracks: [],
      iceServers: [
        {
          urls: "turn:fixture.invalid:3478",
          username: "fixture",
          credential: "fixture-only",
        },
      ],
      iceTransportPolicy: "relay",
    },
  });
  await client.queue;
  assert.equal(client.snapshot().mediaPeerId, peerID);
  return { client, pc: Peer.all.at(-1), commands, peerID };
}

await test("closing while permission is pending stops late capture without creating a peer", async () => {
  const pending = deferred();
  install(() => pending.promise);
  const sent = [];
  const client = new ConferenceMediaClient(
    (type) => {
      sent.push(type);
      return "request";
    },
    () => {},
  );
  const starting = client.start(true);
  client.stop();
  const stream = new Stream([new Track("audio"), new Track("video")]);
  pending.resolve(stream);
  await starting;
  assert.ok(stream.getTracks().every((track) => track.readyState === "ended"));
  assert.equal(sent.includes("media.join"), false);
  assert.equal(client.snapshot().active, false);
});

await test("moderator revocation stops hardware while media.join is pending", async () => {
  const stream = new Stream([new Track("audio"), new Track("video")]);
  install(async () => stream);
  const client = new ConferenceMediaClient(
    () => "join",
    () => {},
  );
  try {
    await client.start();
    client.setPolicy({
      version: 2,
      microphoneBlocked: true,
      cameraBlocked: true,
    });
    assert.ok(
      stream.getTracks().every((track) => track.readyState === "ended"),
    );
    client.setPolicy({ version: 1 });
    assert.equal(client.snapshot().cameraEnabled, false);
  } finally {
    client.stop();
  }
});

await test("TURN relay policy reaches RTCPeerConnection and stopping detaches all callbacks and tracks", async () => {
  install();
  const { client, pc } = await joined();
  try {
    assert.equal(pc.options.iceTransportPolicy, "relay");
    assert.equal(pc.options.bundlePolicy, "max-bundle");
    const local = client.snapshot().localStream.getTracks();
    const remote = new Track("video");
    pc.ontrack({ track: remote, streams: [new Stream([remote])] });
    const receivers = pc.getReceivers().map((receiver) => receiver.track);
    client.stop();
    client.stop();
    for (const track of [...local, ...receivers, remote]) {
      assert.equal(track.readyState, "ended");
      assert.equal(track.onended, null);
    }
    for (const field of [
      "ontrack",
      "onicecandidate",
      "onconnectionstatechange",
      "oniceconnectionstatechange",
      "onsignalingstatechange",
    ])
      assert.equal(pc[field], null);
    assert.equal(pc.closed, true);
    assert.equal(client.snapshot().localStream, null);
  } finally {
    client.stop();
  }
});

await test("revocation wins a device replacement already awaiting the browser sender", async () => {
  install();
  const { client, pc, peerID } = await joined();
  const pending = deferred();
  const entered = deferred();
  const newTrack = new Track("video");
  const original = client.snapshot().localStream.getVideoTracks()[0];
  navigator.mediaDevices.getUserMedia = async () => new Stream([newTrack]);
  const sender = pc.transceivers[1].sender;
  sender.replaceTrack = async (track) => {
    if (track === newTrack) {
      entered.resolve();
      await pending.promise;
    }
    sender.track = track;
  };
  try {
    const replacing = client.changeSource("camera", true, "new-camera");
    await entered.promise;
    client.handle({
      type: "media.policy",
      data: {
        mediaPeerId: peerID,
        policy: { version: 3, cameraBlocked: true },
      },
    });
    assert.equal(
      original.readyState,
      "ended",
      "previous device releases before replacement resolves",
    );
    assert.equal(
      newTrack.readyState,
      "ended",
      "new capture releases even while replaceTrack is still awaiting",
    );
    pending.resolve();
    await replacing;
    await client.queue;
    assert.equal(newTrack.readyState, "ended");
    assert.equal(sender.track, null);
    assert.equal(client.snapshot().cameraEnabled, false);
  } finally {
    pending.resolve();
    client.stop();
  }
});

await test("leave releases pending replacement before the sender promise resolves", async () => {
  install();
  const { client, pc } = await joined();
  const pending = deferred();
  const entered = deferred();
  const track = new Track("audio");
  navigator.mediaDevices.getUserMedia = async () => new Stream([track]);
  pc.transceivers[0].sender.replaceTrack = async () => {
    entered.resolve();
    await pending.promise;
  };
  const replacing = client.changeSource("microphone", true, "pending");
  await entered.promise;
  client.stop();
  assert.equal(track.readyState, "ended");
  pending.resolve();
  await replacing;
});

await test("stop screen releases video and audio before deferred sender cleanup completes", async () => {
  install();
  const { client, pc } = await joined({ capture: false });
  try {
    await client.startScreen();
    const screen = client.snapshot().localScreen.getTracks();
    const pending = deferred();
    pc.transceivers[2].sender.replaceTrack = async () => pending.promise;
    const stopping = client.stopScreen();
    assert.ok(screen.every((track) => track.readyState === "ended"));
    assert.equal(client.snapshot().screenSharing, false);
    pending.resolve();
    await stopping;
    assert.equal(client.snapshot().localScreen, null);
  } finally {
    client.stop();
  }
});

await test("unplugging shared video stops shared audio even if signalling send fails", async () => {
  install();
  const { client, peerID } = await joined({
    capture: false,
    sendError: (type) => type === "media.unpublish",
  });
  try {
    await client.startScreen();
    const screen = client.snapshot().localScreen;
    const video = screen.getVideoTracks()[0];
    client.ownPublished.set("fixture-publication", {
      id: "fixture-publication",
      source: "video/screen",
      mediaPeerId: peerID,
    });
    assert.doesNotThrow(() => video.unplug());
    await client.queue;
    assert.ok(
      screen.getTracks().every((track) => track.readyState === "ended"),
    );
    assert.equal(client.snapshot().screenSharing, false);
  } finally {
    client.stop();
  }
});

await test("closing while display picker is pending releases late selected tracks", async () => {
  install();
  const { client } = await joined({ capture: false });
  const pending = deferred();
  navigator.mediaDevices.getDisplayMedia = () => pending.promise;
  const sharing = client.startScreen();
  client.stop();
  const stream = new Stream([new Track("video"), new Track("audio")]);
  pending.resolve(stream);
  await sharing;
  assert.ok(stream.getTracks().every((track) => track.readyState === "ended"));
  assert.equal(client.snapshot().screenSharing, false);
});

await test("device fallback is allowed for a missing preferred device but never for permission denial", async () => {
  install();
  const { client } = await joined({ capture: false });
  try {
    const requests = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      requests.push(constraints);
      if (requests.length === 1)
        throw new DOMException("missing", "NotFoundError");
      return new Stream([new Track("audio")]);
    };
    await client.changeSource("microphone", true, "removed");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].audio.deviceId, undefined);
    let denied = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      denied++;
      throw new DOMException("denied", "NotAllowedError");
    };
    await client.changeSource("camera", true, "denied");
    assert.equal(denied, 1);
    assert.match(
      client.snapshot().error,
      /настройках конфиденциальности системы/,
    );
  } finally {
    client.stop();
  }
});

await test("desktop device preferences and one-time capture intent cannot cross server profiles", async () => {
  const preferences = await compile(
    "src/prejoinDevices.ts",
    true,
    'export { setDesktopServer } from "./platform/urls";',
  );
  const values = new Map();
  install();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  preferences.setDesktopServer({
    id: "alpha",
    origin: "https://alpha.invalid",
  });
  const changed = {
    ...preferences.readDevicePreferences("same-user"),
    cameraEnabled: false,
  };
  preferences.saveDevicePreferences("same-user", changed);
  preferences.queueMediaEntry("same-conference");
  preferences.setDesktopServer({ id: "beta", origin: "https://beta.invalid" });
  assert.equal(
    preferences.readDevicePreferences("same-user").cameraEnabled,
    true,
  );
  assert.equal(preferences.consumeMediaEntry("same-conference"), false);
  preferences.setDesktopServer({
    id: "alpha",
    origin: "https://alpha.invalid",
  });
  assert.equal(
    preferences.readDevicePreferences("same-user").cameraEnabled,
    false,
  );
  assert.equal(preferences.consumeMediaEntry("same-conference"), true);
  assert.equal(preferences.consumeMediaEntry("same-conference"), false);
});

await test("web pagehide and desktop suspend release subscriptions clean up and never auto-capture on resume", async () => {
  for (const desktop of [false, true]) {
    install();
    let listener;
    let off = 0;
    let releases = 0;
    const methods = [
      "getRuntimeInfo",
      "openExternal",
      "onRoute",
      "minimize",
      "toggleMaximize",
      "close",
      "listServers",
      "probeServer",
      "addServer",
      "selectServer",
      "removeServer",
      "http",
      "abortRequest",
      "openStream",
      "closeStream",
      "openSocket",
      "sendSocket",
      "closeSocket",
      "onTransportEvent",
      "onDisplayCaptureEvent",
      "selectDisplaySource",
      "cancelDisplaySource",
      "quit", "getNativePreferences", "setNativePreferences", "setNotificationContext",
      "getUpdateState", "checkUpdates", "downloadUpdate", "cancelUpdate", "installUpdate",
      "saveAsset", "openRecordingMedia", "closeRecordingMedia", "cancelAsset",
    ];
    window.meetspaceDesktop = Object.fromEntries(
      methods.map((name) => [name, () => {}]),
    );
    window.meetspaceDesktop.bridgeVersion = 5;
    window.meetspaceDesktop.onTransportEvent = (handler) => {
      listener = handler;
      return () => {
        off++;
      };
    };
    const { subscribeCaptureRelease } = await compile(
      "src/platform/captureLifecycle.ts",
      desktop,
    );
    const unsubscribe = subscribeCaptureRelease(() => releases++);
    window.dispatchEvent(new Event("pagehide"));
    assert.equal(releases, 1);
    if (desktop) {
      listener({ kind: "lifecycle", type: "suspend" });
      listener({ kind: "lifecycle", type: "resume" });
      assert.equal(releases, 2);
      listener({ kind: "lifecycle", type: "quit" });
      assert.equal(releases, 3);
    }
    unsubscribe();
    window.dispatchEvent(new Event("pagehide"));
    assert.equal(releases, desktop ? 3 : 1);
    assert.equal(off, desktop ? 1 : 0);
  }
});
