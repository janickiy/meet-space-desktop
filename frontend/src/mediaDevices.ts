export interface VideoCaptureProfile {
  maxWidth: number;
  maxHeight: number;
  maxFrameRate: number;
}

/** One bounded profile for previews and the existing conference client. */
export function inputTrackConstraints(
  kind: "audio" | "video",
  deviceId: string,
  noiseSuppression: boolean,
  video: VideoCaptureProfile = {
    maxWidth: 1280,
    maxHeight: 720,
    maxFrameRate: 30,
  },
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    ...(kind === "audio"
      ? { echoCancellation: true, noiseSuppression, autoGainControl: true }
      : {
          width: { ideal: video.maxWidth, max: video.maxWidth },
          height: { ideal: video.maxHeight, max: video.maxHeight },
          frameRate: { ideal: video.maxFrameRate, max: video.maxFrameRate },
        }),
  };
}

/** A missing saved device may use the system default, never a denied or busy device. */
export async function captureWithDeviceFallback(
  preferred: MediaStreamConstraints,
  fallback: MediaStreamConstraints | undefined,
  isCurrent: () => boolean,
): Promise<{ stream: MediaStream; usedFallback: boolean } | undefined> {
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia(preferred),
      usedFallback: false,
    };
  } catch (error) {
    const name =
      error && typeof error === "object" && "name" in error ? error.name : "";
    if (
      !fallback ||
      (name !== "NotFoundError" && name !== "OverconstrainedError")
    )
      throw error;
    if (!isCurrent()) return;
    return {
      stream: await navigator.mediaDevices.getUserMedia(fallback),
      usedFallback: true,
    };
  }
}

type AudioOutput = { setSinkId?: (sinkId: string) => Promise<void> };
type AudioOutputInventory = readonly Pick<
  MediaDeviceInfo,
  "kind" | "deviceId"
>[];
export type AudioOutputResult =
  "selected" | "fallback" | "unavailable" | "superseded";

// One queue per element survives React effect replacement. An older pending
// browser operation must finish before a newer output selection is applied.
const outputQueues = new WeakMap<
  AudioOutput,
  { revision: number; tail: Promise<void> }
>();

export function routeAudioOutput(
  output: AudioOutput,
  sinkId: string,
  isCurrent: () => boolean,
  readDevices?: () => Promise<AudioOutputInventory>,
): Promise<AudioOutputResult> {
  let queue = outputQueues.get(output);
  if (!queue) {
    queue = { revision: 0, tail: Promise.resolve() };
    outputQueues.set(output, queue);
  }
  const state = queue;
  const revision = ++state.revision;
  const current = () => state.revision === revision && isCurrent();
  const result = state.tail.then(async (): Promise<AudioOutputResult> => {
    if (!current()) return "superseded";
    if (!output.setSinkId) return sinkId ? "unavailable" : "selected";
    let selectedSink = sinkId;
    if (sinkId && readDevices) {
      try {
        const devices = await readDevices();
        if (!current()) return "superseded";
        const outputs = devices.filter(
          (device) => device.kind === "audiooutput",
        );
        // Blank/redacted IDs and aliases alone cannot prove that a saved
        // physical output disappeared. Never infer unplugging from denial.
        const identified = outputs.some(
          (device) =>
            device.deviceId &&
            !["default", "communications"].includes(device.deviceId),
        );
        if (identified && !outputs.some((device) => device.deviceId === sinkId))
          selectedSink = "";
      } catch {
        // Inventory may be unavailable before permissions. A real routing
        // failure below can still use the existing bounded default fallback.
      }
    }
    if (!current()) return "superseded";
    try {
      // setSinkId(currentId) resolves even for an unplugged device. Inventory
      // must select the default explicitly instead of trusting that resolve.
      await output.setSinkId(selectedSink);
      return current()
        ? selectedSink === sinkId
          ? "selected"
          : "fallback"
        : "superseded";
    } catch {
      if (!current()) return "superseded";
      if (!selectedSink) return "unavailable";
      try {
        await output.setSinkId("");
        return current() ? "fallback" : "superseded";
      } catch {
        return current() ? "unavailable" : "superseded";
      }
    }
  });
  state.tail = result.then(
    () => {},
    () => {},
  );
  return result;
}
