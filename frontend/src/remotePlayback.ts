import { routeAudioOutput, type AudioOutputResult } from "./mediaDevices";

type PlaybackElement = Pick<
  HTMLMediaElement,
  "muted" | "srcObject" | "play" | "pause"
> & { setSinkId?: (sinkId: string) => Promise<void> };

const owners = new WeakMap<PlaybackElement, symbol>();

/** Attach incoming media silently; only a current successful output route may play it. */
export function createRemotePlayback(
  element: PlaybackElement,
  stream: MediaStream,
  sinkId: string,
  options: {
    readDevices?: () => Promise<
      readonly Pick<MediaDeviceInfo, "kind" | "deviceId">[]
    >;
    onOutput: (result: AudioOutputResult) => void;
    onBlocked: (blocked: boolean) => void;
  },
) {
  const owner = Symbol();
  owners.set(element, owner);
  let disposed = false;
  let revision = 0;
  let routed = false;
  const current = (expected: number) =>
    !disposed && owners.get(element) === owner && revision === expected;
  element.muted = true;
  element.pause();
  element.srcObject = stream;

  const play = async (expected: number) => {
    if (!current(expected) || !routed) return;
    try {
      await element.play();
      if (current(expected)) options.onBlocked(false);
    } catch {
      if (current(expected)) options.onBlocked(true);
    }
  };
  return {
    async refreshOutput() {
      if (disposed || owners.get(element) !== owner) return;
      const expected = ++revision;
      routed = false;
      element.muted = true;
      element.pause();
      const result = await routeAudioOutput(
        element,
        sinkId,
        () => current(expected),
        options.readDevices,
      );
      if (!current(expected) || result === "superseded") return;
      options.onOutput(result);
      if (
        !current(expected) ||
        (result !== "selected" && result !== "fallback")
      )
        return;
      routed = true;
      element.muted = false;
      await play(expected);
    },
    retry() {
      // A user click can retry an autoplay rejection synchronously, but cannot
      // bypass a failed/pending output route or revive a disposed stream.
      return play(revision);
    },
    dispose() {
      disposed = true;
      routed = false;
      revision++;
      if (owners.get(element) !== owner) return;
      owners.delete(element);
      element.muted = true;
      element.pause();
      element.srcObject = null;
    },
  };
}
