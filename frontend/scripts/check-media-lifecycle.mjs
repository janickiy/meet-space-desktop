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
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
const { captureWithDeviceFallback, inputTrackConstraints, routeAudioOutput } =
  await compile("src/mediaDevices.ts");
const { createRemotePlayback } = await compile("src/remotePlayback.ts");
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

await test("stopping or revoking screen intent rejects late picker consent and permits only a fresh explicit retry", async () => {
  for (const action of ["stop", "screen-policy", "camera-policy"]) {
    install();
    const { client, pc } = await joined({ capture: false });
    const pending = deferred();
    let requests = 0;
    navigator.mediaDevices.getDisplayMedia = () => {
      requests++;
      return pending.promise;
    };
    try {
      const starting = client.startScreen();
      if (action === "stop") await client.stopScreen();
      else {
        const field =
          action === "screen-policy" ? "screenBlocked" : "cameraBlocked";
        client.setPolicy({ version: 1, [field]: true });
        client.setPolicy({ version: 2, [field]: false });
      }
      const late = new Stream([new Track("video"), new Track("audio")]);
      pending.resolve(late);
      await starting;
      await client.queue;
      assert.ok(
        late.getTracks().every((track) => track.readyState === "ended"),
        action,
      );
      assert.equal(client.snapshot().screenSharing, false);
      assert.equal(pc.transceivers[2].sender.track, null);
      assert.equal(pc.transceivers[3].sender.track, null);
      assert.equal(
        requests,
        1,
        "discarding stale consent never requests another capture",
      );
      navigator.mediaDevices.getDisplayMedia = async () => {
        requests++;
        return new Stream([new Track("video")]);
      };
      await client.startScreen();
      assert.equal(requests, 2);
      assert.equal(
        client.snapshot().screenSharing,
        true,
        "a later explicit action gets independent fresh consent",
      );
    } finally {
      pending.resolve(new Stream());
      client.stop();
    }
  }
});

await test("cancelling a queued screen publication releases capture and cannot install its sender later", async () => {
  install();
  const { client, pc } = await joined({ capture: false });
  const queued = deferred();
  const captured = new Stream([new Track("video"), new Track("audio")]);
  navigator.mediaDevices.getDisplayMedia = async () => captured;
  client.queue = queued.promise;
  const starting = client.startScreen();
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = client.stopScreen();
  assert.ok(
    captured.getTracks().every((track) => track.readyState === "ended"),
  );
  queued.resolve();
  try {
    await Promise.all([starting, stopping]);
    assert.equal(client.snapshot().screenSharing, false);
    assert.equal(pc.transceivers[2].sender.track, null);
    assert.equal(pc.transceivers[3].sender.track, null);
  } finally {
    queued.resolve();
    client.stop();
  }
});

await test("stop during the screen video sender await never installs the already cancelled screen audio", async () => {
  install();
  const { client, pc } = await joined({ capture: false });
  const pending = deferred();
  const entered = deferred();
  const video = new Track("video");
  const audio = new Track("audio");
  navigator.mediaDevices.getDisplayMedia = async () =>
    new Stream([video, audio]);
  const videoSender = pc.transceivers[2].sender;
  videoSender.replaceTrack = async (track) => {
    if (track === video) {
      entered.resolve();
      await pending.promise;
    }
    videoSender.track = track;
  };
  const audioCalls = [];
  const audioSender = pc.transceivers[3].sender;
  audioSender.replaceTrack = async (track) => {
    audioCalls.push(track);
    audioSender.track = track;
  };
  const starting = client.startScreen();
  await entered.promise;
  const stopping = client.stopScreen();
  assert.equal(video.readyState, "ended");
  assert.equal(audio.readyState, "ended");
  pending.resolve();
  try {
    await Promise.all([starting, stopping]);
    assert.equal(audioCalls.includes(audio), false);
    assert.equal(client.snapshot().screenSharing, false);
    assert.equal(videoSender.track, null);
    assert.equal(audioSender.track, null);
  } finally {
    pending.resolve();
    client.stop();
  }
});

await test("screen ending during either sender replacement cannot claim its image is still being shared", async () => {
  for (const pendingSender of [2, 3]) {
    install();
    const { client, pc } = await joined({ capture: false });
    const video = new Track("video");
    const audio = new Track("audio");
    const pending = deferred();
    const entered = deferred();
    const captured = new Stream([video, audio]);
    navigator.mediaDevices.getDisplayMedia = async () => captured;
    const sender = pc.transceivers[pendingSender].sender;
    const awaited = pendingSender === 2 ? video : audio;
    sender.replaceTrack = async (track) => {
      if (track === awaited) {
        entered.resolve();
        await pending.promise;
      }
      sender.track = track;
    };
    const audioCalls = [];
    if (pendingSender === 2)
      pc.transceivers[3].sender.replaceTrack = async (track) => {
        audioCalls.push(track);
        pc.transceivers[3].sender.track = track;
      };
    const starting = client.startScreen();
    await entered.promise;
    video.unplug();
    pending.resolve();
    try {
      await starting;
      await client.queue;
      assert.ok(
        captured.getTracks().every((track) => track.readyState === "ended"),
      );
      assert.equal(pc.transceivers[2].sender.track, null);
      assert.equal(pc.transceivers[3].sender.track, null);
      assert.equal(client.snapshot().screenSharing, false);
      assert.match(client.snapshot().error, /Захват экрана завершён/);
      assert.equal(
        client.snapshot().error.includes("Изображение продолжает передаваться"),
        false,
      );
      if (pendingSender === 2) assert.equal(audioCalls.includes(audio), false);
    } finally {
      pending.resolve();
      client.stop();
    }
  }
});

await test("mic revocation during screen consent discards late system audio while preserving allowed video", async () => {
  install();
  const { client, pc } = await joined({ capture: false });
  const pending = deferred();
  navigator.mediaDevices.getDisplayMedia = () => pending.promise;
  try {
    const starting = client.startScreen();
    client.setPolicy({ version: 1, microphoneBlocked: true });
    client.setPolicy({ version: 2, microphoneBlocked: false });
    const video = new Track("video");
    const audio = new Track("audio");
    pending.resolve(new Stream([video, audio]));
    await starting;
    assert.equal(video.readyState, "live");
    assert.equal(audio.readyState, "ended");
    assert.equal(client.snapshot().screenSharing, true);
    assert.equal(pc.transceivers[2].sender.track, video);
    assert.equal(pc.transceivers[3].sender.track, null);
    await client.stopScreen();
    const freshVideo = new Track("video");
    const freshAudio = new Track("audio");
    let requests = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      requests++;
      return new Stream([freshVideo, freshAudio]);
    };
    await client.startScreen();
    assert.equal(
      requests,
      1,
      "only a fresh explicit capture can publish audio after moderation allowed it again",
    );
    assert.equal(pc.transceivers[2].sender.track, freshVideo);
    assert.equal(pc.transceivers[3].sender.track, freshAudio);
  } finally {
    pending.resolve(new Stream());
    client.stop();
  }
});

await test("screen capture cancellation, unavailable sources and gesture errors leave camera and microphone running", async () => {
  for (const [name, message] of [
    ["NotAllowedError", /выбор отменён или система не разрешила/],
    ["NotFoundError", /Не удалось получить экран или окно/],
    ["NotReadableError", /выбранный экран или окно/],
    ["InvalidStateError", /вернитесь в окно MeetSpace/],
    ["NotSupportedError", /недоступна в этой среде/],
  ]) {
    install();
    const { client, pc } = await joined();
    const local = client.snapshot().localStream.getTracks();
    let requests = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      requests++;
      throw { name, message: "raw private backend details" };
    };
    try {
      await client.startScreen();
      assert.equal(requests, 1);
      assert.equal(client.snapshot().active, true);
      assert.equal(client.snapshot().screenSharing, false);
      assert.ok(local.every((track) => track.readyState === "live"));
      assert.match(client.snapshot().error, message);
      assert.equal(client.snapshot().error.includes("raw private"), false);
      assert.equal(pc.transceivers[2].sender.track, null);
      assert.equal(pc.transceivers[3].sender.track, null);
    } finally {
      client.stop();
    }
  }
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
    outputVolume: 37,
  };
  preferences.saveDevicePreferences("same-user", changed);
  preferences.queueMediaEntry("same-conference");
  preferences.setDesktopServer({ id: "beta", origin: "https://beta.invalid" });
  assert.equal(
    preferences.readDevicePreferences("same-user").cameraEnabled,
    true,
  );
  assert.equal(preferences.consumeMediaEntry("same-conference"), false);
  assert.equal(
    preferences.readDevicePreferences("same-user").outputVolume,
    100,
  );
  preferences.setDesktopServer({
    id: "alpha",
    origin: "https://alpha.invalid",
  });
  assert.equal(
    preferences.readDevicePreferences("same-user").cameraEnabled,
    false,
  );
  assert.equal(preferences.readDevicePreferences("same-user").outputVolume, 37);
  assert.equal(
    preferences.readDevicePreferences("another-user").outputVolume,
    100,
  );
  for (const [stored, expected] of [
    [undefined, 100],
    [-5, 0],
    [140, 100],
    ["37", 100],
  ]) {
    preferences.saveDevicePreferences("same-user", {
      ...changed,
      outputVolume: stored,
    });
    assert.equal(
      preferences.readDevicePreferences("same-user").outputVolume,
      expected,
    );
  }
  assert.equal(preferences.consumeMediaEntry("same-conference"), true);
  assert.equal(preferences.consumeMediaEntry("same-conference"), false);
});

function installLifecycleBridge() {
  const listeners = new Set();
  let off = 0;
  const methods = [
    "getRuntimeInfo",
    "getSshInstallerState",
    "sshInstaller",
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
    "quit",
    "getNativePreferences",
    "setNativePreferences",
    "setNotificationContext",
    "getUpdateState",
    "checkUpdates",
    "downloadUpdate",
    "cancelUpdate",
    "installUpdate",
    "saveAsset",
    "openRecordingMedia",
    "closeRecordingMedia",
    "cancelAsset",
  ];
  window.meetspaceDesktop = Object.fromEntries(
    methods.map((name) => [name, () => {}]),
  );
  window.meetspaceDesktop.bridgeVersion = 6;
  window.meetspaceDesktop.getRuntimeInfo = async () => ({
    platform: "win32",
    arch: "x64",
    appVersion: "0.1.1-beta",
    isPackaged: true,
    capabilities: { serverConnection: true, windowControls: true },
    host: {
      session: "not-applicable",
      secureStorage: {
        available: true,
        backend: "dpapi",
        reason: "available",
      },
      supports: {
        startup: true,
        absoluteWindowPosition: true,
        systemAudio: true,
      },
    },
  });
  window.meetspaceDesktop.onTransportEvent = (handler) => {
    listeners.add(handler);
    return () => {
      off++;
      listeners.delete(handler);
    };
  };
  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    get off() {
      return off;
    },
  };
}

await test("web pagehide and desktop suspend release subscriptions clean up and never auto-capture on resume", async () => {
  for (const desktop of [false, true]) {
    install();
    const bridge = installLifecycleBridge();
    let releases = 0;
    const { subscribeCaptureRelease } = await compile(
      "src/platform/captureLifecycle.ts",
      desktop,
    );
    const unsubscribe = subscribeCaptureRelease(() => releases++);
    window.dispatchEvent(new Event("pagehide"));
    assert.equal(releases, 1);
    if (desktop) {
      bridge.emit({ kind: "lifecycle", type: "suspend" });
      bridge.emit({ kind: "lifecycle", type: "resume" });
      assert.equal(releases, 2);
      bridge.emit({ kind: "lifecycle", type: "quit" });
      assert.equal(releases, 3);
    }
    unsubscribe();
    window.dispatchEvent(new Event("pagehide"));
    assert.equal(releases, desktop ? 3 : 1);
    assert.equal(bridge.off, desktop ? 1 : 0);
  }
});

await test("private-call reconnect preserves mute, but lifecycle release clears old capture intent until an explicit enable", async () => {
  for (const desktop of [false, true]) {
    const requests = [];
    install(async (constraints) => {
      requests.push(constraints);
      return new Stream([
        ...(constraints.audio ? [new Track("audio")] : []),
        ...(constraints.video ? [new Track("video")] : []),
      ]);
    });
    const bridge = installLifecycleBridge();
    const { subscribeCaptureRelease, subscribeCaptureIntentRelease } =
      await compile("src/platform/captureLifecycle.ts", desktop);
    const desired = {
      current: { microphoneEnabled: true, cameraEnabled: false },
    };
    const preferences = { microphoneEnabled: true, cameraEnabled: true };
    let active;
    const releaseHardware = subscribeCaptureRelease(() => active?.stop());
    const releaseIntent = subscribeCaptureIntentRelease(desired);
    const reconnect = async () => {
      active?.stop();
      ({ client: active } = await joined({
        options: { ...preferences, ...desired.current },
      }));
    };
    try {
      await reconnect();
      await reconnect();
      assert.equal(
        requests.length,
        2,
        "a normal network reconnect retains the active microphone",
      );
      assert.ok(
        requests.every(
          (constraints) => constraints.audio && constraints.video === false,
        ),
        "network reconnect never unmutes the camera",
      );
      const captured = active.snapshot().localStream.getTracks();
      if (desktop) bridge.emit({ kind: "lifecycle", type: "suspend" });
      else window.dispatchEvent(new Event("pagehide"));
      assert.ok(captured.every((track) => track.readyState === "ended"));
      assert.deepEqual(desired.current, {
        microphoneEnabled: false,
        cameraEnabled: false,
      });
      if (desktop) bridge.emit({ kind: "lifecycle", type: "resume" });
      await reconnect();
      assert.equal(
        requests.length,
        2,
        "resume/socket reconnect cannot re-use capture intent from before release",
      );
      assert.equal(active.snapshot().microphoneEnabled, false);
      assert.equal(active.snapshot().cameraEnabled, false);
      await active.changeSource("microphone", true);
      assert.equal(
        requests.length,
        3,
        "an explicit enable after resume is still allowed",
      );
      assert.equal(active.snapshot().microphoneEnabled, true);
      releaseIntent();
      releaseHardware();
      desired.current = { microphoneEnabled: true, cameraEnabled: true };
      if (desktop) bridge.emit({ kind: "lifecycle", type: "quit" });
      window.dispatchEvent(new Event("pagehide"));
      assert.deepEqual(
        desired.current,
        { microphoneEnabled: true, cameraEnabled: true },
        "unmounted subscriptions cannot change later call intent",
      );
      assert.equal(bridge.off, desktop ? 2 : 0);
    } finally {
      releaseIntent();
      releaseHardware();
      active?.stop();
    }
  }
});

await test("preview and call capture share bounded camera and echo-controlled microphone constraints", () => {
  const camera = inputTrackConstraints("video", "camera-1", true);
  assert.deepEqual(camera.deviceId, { exact: "camera-1" });
  assert.deepEqual(camera.width, { ideal: 1280, max: 1280 });
  assert.deepEqual(camera.height, { ideal: 720, max: 720 });
  assert.deepEqual(camera.frameRate, { ideal: 30, max: 30 });
  const serverProfile = inputTrackConstraints("video", "", true, {
    maxWidth: 640,
    maxHeight: 360,
    maxFrameRate: 15,
  });
  assert.deepEqual(serverProfile.width, { ideal: 640, max: 640 });
  assert.deepEqual(serverProfile.frameRate, { ideal: 15, max: 15 });
  assert.equal(serverProfile.deviceId, undefined);
  assert.deepEqual(inputTrackConstraints("audio", "", false), {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  });
});

await test("capture fallback accepts browser error names and never retries denied, busy or stale requests", async () => {
  const preferred = { audio: { deviceId: { exact: "missing" } }, video: false };
  const fallback = { audio: true, video: false };
  for (const name of [
    "NotFoundError",
    "OverconstrainedError",
    "NotAllowedError",
    "NotReadableError",
    "SecurityError",
  ]) {
    const requested = [];
    const stream = new Stream([new Track("audio")]);
    install(async (constraints) => {
      requested.push(constraints);
      if (requested.length === 1) throw { name };
      return stream;
    });
    if (["NotFoundError", "OverconstrainedError"].includes(name)) {
      const result = await captureWithDeviceFallback(
        preferred,
        fallback,
        () => true,
      );
      assert.equal(result.stream, stream);
      assert.equal(result.usedFallback, true);
      assert.deepEqual(requested, [preferred, fallback]);
    } else {
      await assert.rejects(
        captureWithDeviceFallback(preferred, fallback, () => true),
        { name },
      );
      assert.equal(requested.length, 1);
    }
  }
  let captures = 0;
  install(async () => {
    captures++;
    throw { name: "NotFoundError" };
  });
  assert.equal(
    await captureWithDeviceFallback(preferred, fallback, () => false),
    undefined,
  );
  assert.equal(
    captures,
    1,
    "a closed preview never starts another hardware request",
  );
});

await test("unplug before media.joined updates intent and never publishes the ended camera", async () => {
  const microphone = new Track("audio");
  const camera = new Track("video");
  let captures = 0;
  install(async () => {
    captures++;
    return new Stream([microphone, camera]);
  });
  const commands = [];
  const client = new ConferenceMediaClient(
    (type, data) => {
      const id = randomUUID();
      commands.push({ type, data, id });
      return id;
    },
    () => {},
  );
  try {
    await client.start();
    assert.equal(client.snapshot().cameraEnabled, true);
    camera.unplug();
    assert.equal(client.snapshot().cameraEnabled, false);
    assert.equal(client.snapshot().microphoneEnabled, true);
    assert.match(client.snapshot().error, /Камера отключена/);
    client.handle({
      type: "media.joined",
      replyTo: commands[0].id,
      data: {
        mediaPeerId: randomUUID(),
        workerId: "fixture",
        maxPeers: 2,
        tracks: [],
        iceServers: [],
      },
    });
    await client.queue;
    const pc = Peer.all.at(-1);
    assert.equal(pc.transceivers[1].sender.track, null);
    assert.equal(pc.transceivers[0].sender.track, microphone);
    assert.equal(captures, 1, "unplugging never enables a replacement device");
  } finally {
    client.stop();
  }
});

await test("active microphone unplug is immediate and selecting devices while muted does not recapture", async () => {
  install();
  const { client, pc } = await joined();
  const microphone = client.snapshot().localStream.getAudioTracks()[0];
  const camera = client.snapshot().localStream.getVideoTracks()[0];
  let captures = 0;
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    captures++;
    assert.deepEqual(constraints.audio.deviceId, { exact: "new-headset" });
    return new Stream([new Track("audio")]);
  };
  try {
    microphone.unplug();
    assert.equal(client.snapshot().microphoneEnabled, false);
    assert.match(client.snapshot().error, /Микрофон отключён/);
    await client.queue;
    assert.equal(pc.transceivers[0].sender.track, null);
    assert.equal(camera.readyState, "live");
    client.configure({ audioInputId: "new-headset" });
    assert.equal(captures, 0);
    await client.changeSource("microphone", true);
    assert.equal(captures, 1);
    assert.equal(client.snapshot().microphoneEnabled, true);
  } finally {
    client.stop();
  }
});

await test("successful switch releases the previous input; busy replacement keeps the current device", async () => {
  install();
  const { client, pc } = await joined();
  const original = client.snapshot().localStream.getAudioTracks()[0];
  const replacement = new Track("audio");
  navigator.mediaDevices.getUserMedia = async () => new Stream([replacement]);
  try {
    await client.changeSource("microphone", true, "headset");
    assert.equal(original.readyState, "ended");
    assert.equal(replacement.readyState, "live");
    assert.equal(pc.transceivers[0].sender.track, replacement);
    let requests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      requests++;
      throw { name: "NotReadableError" };
    };
    await client.changeSource("microphone", true, "busy-headset");
    assert.equal(requests, 1);
    assert.equal(pc.transceivers[0].sender.track, replacement);
    assert.equal(replacement.readyState, "live");
    assert.match(client.snapshot().error, /занято другим приложением/);
  } finally {
    client.stop();
  }
});

await test("input ending during sender replacement is detached before deferred sender cleanup completes", async () => {
  for (const [source, kind, index, flag, message] of [
    ["microphone", "audio", 0, "microphoneEnabled", /Микрофон отключён/],
    ["camera", "video", 1, "cameraEnabled", /Камера отключена/],
  ]) {
    install();
    const { client, pc } = await joined();
    const original = client
      .snapshot()
      .localStream.getTracks()
      .find((track) => track.kind === kind);
    const replacement = new Track(kind);
    const first = deferred();
    const entered = deferred();
    const cleanup = deferred();
    const cleaning = deferred();
    const calls = [];
    const sender = pc.transceivers[index].sender;
    sender.replaceTrack = async (track) => {
      calls.push(track);
      if (track === replacement) {
        entered.resolve();
        await first.promise;
      } else if (track === null) {
        cleaning.resolve();
        await cleanup.promise;
      }
      sender.track = track;
    };
    let captures = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      captures++;
      return new Stream([replacement]);
    };
    try {
      const replacing = client.changeSource(source, true, "temporary-headset");
      await entered.promise;
      replacement.unplug();
      first.resolve();
      await cleaning.promise;
      assert.equal(
        original.readyState,
        "ended",
        "the old hardware is already released while detach awaits",
      );
      assert.equal(replacement.readyState, "ended");
      assert.equal(client.snapshot()[flag], false);
      assert.match(client.snapshot().error, message);
      assert.equal(pc.transceivers[index].direction, "recvonly");
      assert.equal(
        client.snapshot().localStream.getTracks().includes(replacement),
        false,
      );
      assert.equal(
        client.snapshot().localStream.getTracks().includes(original),
        false,
      );
      cleanup.resolve();
      await replacing;
      assert.equal(sender.track, null);
      assert.equal(
        captures,
        1,
        "a lost replacement never starts another device",
      );
      assert.deepEqual(calls, [replacement, null]);
    } finally {
      first.resolve();
      cleanup.resolve();
      client.stop();
    }
  }
});

await test("a stale failed output switch cannot reset a newer headset to the system default", async () => {
  const pending = deferred();
  const entered = deferred();
  const requests = [];
  const output = {
    async setSinkId(id) {
      requests.push(id);
      if (id === "removed-headset") {
        entered.resolve();
        await pending.promise;
      }
    },
  };
  let firstActive = true;
  const first = routeAudioOutput(output, "removed-headset", () => firstActive);
  await entered.promise;
  firstActive = false;
  const skipped = routeAudioOutput(output, "intermediate", () => true);
  const latest = routeAudioOutput(output, "current-headset", () => true);
  pending.reject(new DOMException("unplugged", "NotFoundError"));
  assert.equal(await first, "superseded");
  assert.equal(await skipped, "superseded");
  assert.equal(await latest, "selected");
  assert.deepEqual(requests, ["removed-headset", "current-headset"]);
});

await test("output routing explicitly resets the default, reports fallback failure and stops after disposal", async () => {
  const requests = [];
  const output = {
    async setSinkId(id) {
      requests.push(id);
      if (id === "removed") throw new Error("missing");
    },
  };
  assert.equal(
    await routeAudioOutput(output, "headset", () => true),
    "selected",
  );
  assert.equal(await routeAudioOutput(output, "", () => true), "selected");
  assert.equal(
    await routeAudioOutput(output, "removed", () => true),
    "fallback",
  );
  assert.deepEqual(requests, ["headset", "", "removed", ""]);
  assert.equal(
    await routeAudioOutput(output, "unused", () => false),
    "superseded",
  );
  assert.equal(requests.includes("unused"), false);
  assert.equal(
    await routeAudioOutput(
      {
        async setSinkId() {
          throw new Error("no output");
        },
      },
      "removed",
      () => true,
    ),
    "unavailable",
  );
  assert.equal(
    await routeAudioOutput({}, "headset", () => true),
    "unavailable",
  );
});

await test("output disappearance uses inventory even when same-ID setSinkId resolves without checking hardware", async () => {
  let devices = [
    { kind: "audiooutput", deviceId: "default" },
    { kind: "audiooutput", deviceId: "system-speakers" },
    { kind: "audiooutput", deviceId: "headset" },
  ];
  const calls = [];
  const output = {
    sinkId: "",
    async setSinkId(id) {
      calls.push(id);
      // This early success is required by the Audio Output Devices API, even
      // after this device disappears. It cannot establish hardware availability.
      if (id === this.sinkId) return;
      if (id && !devices.some((device) => device.deviceId === id))
        throw new DOMException("missing output", "NotFoundError");
      this.sinkId = id;
    },
  };
  const preference = "headset";
  assert.equal(
    await routeAudioOutput(
      output,
      preference,
      () => true,
      async () => devices,
    ),
    "selected",
  );
  devices = devices.filter((device) => device.deviceId !== "headset");
  await output.setSinkId(preference);
  assert.equal(
    output.sinkId,
    "headset",
    "a same-ID resolve leaves the unavailable sink selected",
  );
  assert.equal(
    await routeAudioOutput(
      output,
      preference,
      () => true,
      async () => devices,
    ),
    "fallback",
  );
  assert.equal(output.sinkId, "");
  assert.equal(
    preference,
    "headset",
    "the stored choice remains available for a later explicit re-selection",
  );
  assert.deepEqual(calls, ["headset", "headset", ""]);
});

await test("stale inventory cannot reset a newer output selection to the default", async () => {
  const inventory = deferred();
  const entered = deferred();
  const calls = [];
  const output = {
    async setSinkId(id) {
      calls.push(id);
    },
  };
  const old = routeAudioOutput(
    output,
    "old-headset",
    () => true,
    async () => {
      entered.resolve();
      return inventory.promise;
    },
  );
  await entered.promise;
  const latest = routeAudioOutput(output, "current-headset", () => true);
  inventory.resolve([{ kind: "audiooutput", deviceId: "system-speakers" }]);
  assert.equal(await old, "superseded");
  assert.equal(await latest, "selected");
  assert.deepEqual(calls, ["current-headset"]);
});

await test("empty, redacted or denied output inventory never proves a preferred headset was unplugged", async () => {
  const inventories = [
    [],
    [{ kind: "audiooutput", deviceId: "" }],
    [
      { kind: "audiooutput", deviceId: "default" },
      { kind: "audiooutput", deviceId: "communications" },
    ],
    [{ kind: "audioinput", deviceId: "known-microphone" }],
  ];
  for (const devices of inventories) {
    const calls = [];
    const output = {
      async setSinkId(id) {
        calls.push(id);
      },
    };
    assert.equal(
      await routeAudioOutput(
        output,
        "headset",
        () => true,
        async () => devices,
      ),
      "selected",
    );
    assert.deepEqual(calls, ["headset"]);
  }
  const calls = [];
  const output = {
    async setSinkId(id) {
      calls.push(id);
    },
  };
  assert.equal(
    await routeAudioOutput(
      output,
      "headset",
      () => true,
      async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    ),
    "selected",
  );
  assert.deepEqual(calls, ["headset"]);
});

function playbackElement() {
  return {
    muted: false,
    srcObject: null,
    sinkId: "",
    plays: [],
    pauses: 0,
    async setSinkId(id) {
      this.sinkId = id;
    },
    async play() {
      this.plays.push({
        muted: this.muted,
        sinkId: this.sinkId,
        stream: this.srcObject,
      });
    },
    pause() {
      this.pauses++;
    },
  };
}

await test("remote media remains silent until both inventory and the selected sink have resolved", async () => {
  const inventory = deferred();
  const checking = deferred();
  const sink = deferred();
  const routing = deferred();
  const element = playbackElement();
  element.setSinkId = async (id) => {
    routing.resolve();
    await sink.promise;
    element.sinkId = id;
  };
  const stream = new Stream([new Track("audio")]);
  const outputs = [];
  const playback = createRemotePlayback(element, stream, "headset", {
    readDevices: async () => {
      checking.resolve();
      return inventory.promise;
    },
    onOutput: (result) => outputs.push(result),
    onBlocked() {},
  });
  try {
    assert.equal(
      element.muted,
      true,
      "muting precedes attaching incoming media",
    );
    assert.equal(element.srcObject, stream);
    const started = playback.refreshOutput();
    await checking.promise;
    assert.deepEqual(element.plays, []);
    assert.equal(element.muted, true);
    inventory.resolve([{ kind: "audiooutput", deviceId: "headset" }]);
    await routing.promise;
    assert.deepEqual(element.plays, []);
    assert.equal(element.muted, true);
    sink.resolve();
    await started;
    assert.deepEqual(outputs, ["selected"]);
    assert.deepEqual(element.plays, [
      { muted: false, sinkId: "headset", stream },
    ]);
  } finally {
    inventory.resolve([]);
    sink.resolve();
    playback.dispose();
  }
});

await test("unavailable remote output stays muted and an autoplay retry cannot bypass it", async () => {
  const element = playbackElement();
  element.setSinkId = async () => {
    throw new Error("no output");
  };
  const outputs = [];
  const playback = createRemotePlayback(
    element,
    new Stream([new Track("audio")]),
    "headset",
    {
      onOutput: (result) => outputs.push(result),
      onBlocked() {},
    },
  );
  try {
    await playback.refreshOutput();
    await playback.retry();
    assert.deepEqual(outputs, ["unavailable"]);
    assert.equal(element.muted, true);
    assert.deepEqual(element.plays, []);
  } finally {
    playback.dispose();
  }
});

await test("remote playback may use an explicit successful fallback and retains autoplay-blocked retry", async () => {
  const element = playbackElement();
  let routes = 0;
  element.setSinkId = async (id) => {
    routes++;
    if (id) throw new Error("headset missing");
    element.sinkId = id;
  };
  let attempts = 0;
  element.play = async () => {
    attempts++;
    if (attempts === 1)
      throw new DOMException("interaction required", "NotAllowedError");
  };
  const outputs = [];
  const blocked = [];
  const playback = createRemotePlayback(
    element,
    new Stream([new Track("audio")]),
    "headset",
    {
      onOutput: (result) => outputs.push(result),
      onBlocked: (value) => blocked.push(value),
    },
  );
  try {
    await playback.refreshOutput();
    assert.deepEqual(outputs, ["fallback"]);
    assert.deepEqual(blocked, [true]);
    assert.equal(element.sinkId, "");
    await playback.retry();
    assert.equal(attempts, 2);
    assert.equal(
      routes,
      2,
      "a retry plays the already verified output in the click's activation",
    );
    assert.deepEqual(blocked, [true, false]);
  } finally {
    playback.dispose();
  }
});

await test("a stale remote route and late cleanup cannot play or detach a newer stream", async () => {
  const pending = deferred();
  const entered = deferred();
  const element = playbackElement();
  element.setSinkId = async (id) => {
    if (id === "old") {
      entered.resolve();
      await pending.promise;
    }
    element.sinkId = id;
  };
  const oldEvents = [];
  const old = createRemotePlayback(
    element,
    new Stream([new Track("audio")]),
    "old",
    {
      onOutput: (result) => oldEvents.push(result),
      onBlocked: (value) => oldEvents.push(value),
    },
  );
  const oldRouting = old.refreshOutput();
  await entered.promise;
  const stream = new Stream([new Track("audio")]);
  const latest = createRemotePlayback(element, stream, "new", {
    onOutput() {},
    onBlocked() {},
  });
  try {
    old.dispose();
    assert.equal(element.srcObject, stream);
    assert.equal(element.muted, true);
    const latestRouting = latest.refreshOutput();
    pending.resolve();
    await Promise.all([oldRouting, latestRouting]);
    assert.deepEqual(oldEvents, []);
    assert.deepEqual(element.plays, [{ muted: false, sinkId: "new", stream }]);
  } finally {
    pending.resolve();
    old.dispose();
    latest.dispose();
  }
});

await test("devicechange re-routing mutes immediately and only its newest route may resume remote audio", async () => {
  const element = playbackElement();
  const stream = new Stream([new Track("audio")]);
  const playback = createRemotePlayback(element, stream, "headset", {
    onOutput() {},
    onBlocked() {},
  });
  try {
    await playback.refreshOutput();
    assert.equal(element.plays.length, 1);
    const pending = deferred();
    const entered = deferred();
    element.setSinkId = async (id) => {
      entered.resolve();
      await pending.promise;
      element.sinkId = id;
    };
    const changing = playback.refreshOutput();
    assert.equal(element.muted, true);
    await entered.promise;
    const latest = playback.refreshOutput();
    pending.resolve();
    await Promise.all([changing, latest]);
    assert.equal(
      element.plays.length,
      2,
      "the superseded devicechange never starts another playback",
    );
    assert.equal(element.muted, false);
    const closing = deferred();
    const closingStarted = deferred();
    element.setSinkId = async () => {
      closingStarted.resolve();
      await closing.promise;
    };
    const last = playback.refreshOutput();
    await closingStarted.promise;
    playback.dispose();
    closing.resolve();
    await last;
    await playback.retry();
    assert.equal(element.plays.length, 2);
    assert.equal(element.muted, true);
    assert.equal(element.srcObject, null);
  } finally {
    playback.dispose();
  }
});

await test("a late play completion cannot unmute or clear state after output failure", async () => {
  const pendingPlay = deferred();
  const entered = deferred();
  const element = playbackElement();
  element.play = async () => {
    entered.resolve();
    await pendingPlay.promise;
  };
  const blocked = [];
  const outputs = [];
  const playback = createRemotePlayback(
    element,
    new Stream([new Track("audio")]),
    "headset",
    {
      onOutput: (result) => outputs.push(result),
      onBlocked: (value) => blocked.push(value),
    },
  );
  try {
    const starting = playback.refreshOutput();
    await entered.promise;
    element.setSinkId = async () => {
      throw new Error("output disconnected");
    };
    await playback.refreshOutput();
    pendingPlay.resolve();
    await starting;
    assert.deepEqual(outputs, ["selected", "unavailable"]);
    assert.deepEqual(
      blocked,
      [],
      "the old play resolution cannot clear a newer output failure",
    );
    assert.equal(element.muted, true);
  } finally {
    pendingPlay.resolve();
    playback.dispose();
  }
});

await test("speaker test never reports a selected headset as tested when only the default sink works", async () => {
  const players = [];
  class AudioFixture {
    constructor() {
      this.plays = 0;
      this.routes = [];
      players.push(this);
    }
    async setSinkId(id) {
      this.routes.push(id);
      if (id) throw new Error("headset missing");
    }
    async play() {
      this.plays++;
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  globalThis.Audio = AudioFixture;
  const { playDeviceTone } = await compile("src/deviceSound.ts");
  let finished;
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  playDeviceTone("headset", (error) => finished(error));
  assert.ok(await done);
  assert.equal(players[0].plays, 0);
  assert.deepEqual(players[0].routes, ["headset", ""]);
});

await test("speaker test plays the selected output at the chosen volume", async () => {
  let player;
  let playbackStarted;
  const started = new Promise((resolve) => {
    playbackStarted = resolve;
  });
  class AudioFixture {
    constructor() {
      this.routes = [];
      this.plays = 0;
      player = this;
    }
    async setSinkId(id) {
      this.routes.push(id);
    }
    async play() {
      this.plays++;
      playbackStarted();
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  globalThis.Audio = AudioFixture;
  const { playDeviceTone } = await compile("src/deviceSound.ts");
  let finished = 0;
  const stop = playDeviceTone(
    "headset",
    (error) => {
      assert.equal(error, undefined);
      finished++;
    },
    0.37,
  );
  try {
    await started;
    assert.deepEqual(player.routes, ["headset"]);
    assert.equal(player.volume, 0.37);
    assert.equal(player.plays, 1);
  } finally {
    stop();
  }
  assert.equal(finished, 1);
});

await test("reused notification player applies system output after clearing a saved headset", async () => {
  install();
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const players = [];
  class AudioFixture {
    constructor() {
      this.routes = [];
      this.plays = 0;
      players.push(this);
    }
    async setSinkId(id) {
      this.routes.push(id);
    }
    async play() {
      this.plays++;
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  globalThis.Audio = AudioFixture;
  const preferences = await compile("src/prejoinDevices.ts", false);
  const { createNotificationSound } = await compile(
    "src/notificationSound.ts",
    false,
  );
  let now = 10000;
  const originalNow = Date.now;
  Date.now = () => now;
  const sound = createNotificationSound("fixture-user");
  try {
    preferences.saveDevicePreferences("fixture-user", {
      ...preferences.readDevicePreferences("fixture-user"),
      notificationOutputId: "headset",
    });
    sound.notify("first");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(players[0].plays, 1);
    now += 2000;
    preferences.saveDevicePreferences("fixture-user", {
      ...preferences.readDevicePreferences("fixture-user"),
      notificationOutputId: "",
    });
    sound.notify("second");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(players.length, 1);
    assert.equal(players[0].plays, 2);
    assert.deepEqual(players[0].routes, ["headset", ""]);
  } finally {
    sound.dispose();
    Date.now = originalNow;
  }
});

await test("notification output preference changes invalidate delayed playback on the old headset", async () => {
  install();
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const pending = deferred();
  const entered = deferred();
  const players = [];
  class AudioFixture {
    constructor() {
      this.routes = [];
      this.plays = [];
      players.push(this);
    }
    async setSinkId(id) {
      this.routes.push(id);
      if (id === "old-headset") {
        entered.resolve();
        await pending.promise;
      }
      this.currentSink = id;
    }
    async play() {
      this.plays.push(this.currentSink);
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  globalThis.Audio = AudioFixture;
  const preferences = await compile("src/prejoinDevices.ts", false);
  const { createNotificationSound } = await compile(
    "src/notificationSound.ts",
    false,
  );
  let now = 10000;
  const originalNow = Date.now;
  Date.now = () => now;
  const sound = createNotificationSound("fixture-user");
  const choose = (id) =>
    preferences.saveDevicePreferences("fixture-user", {
      ...preferences.readDevicePreferences("fixture-user"),
      notificationOutputId: id,
    });
  try {
    choose("old-headset");
    sound.notify("delayed");
    await entered.promise;
    choose("new-headset");
    pending.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      players[0].plays,
      [],
      "the delayed notification is cancelled when its output changes",
    );
    now += 2000;
    sound.notify("current");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(players[0].routes, ["old-headset", "new-headset"]);
    assert.deepEqual(players[0].plays, ["new-headset"]);
  } finally {
    pending.resolve();
    sound.dispose();
    Date.now = originalNow;
  }
});
