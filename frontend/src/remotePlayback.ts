import { routeAudioOutput, type AudioOutputResult } from "./mediaDevices";

type PlaybackElement = Pick<
  HTMLMediaElement,
  "tagName" | "muted" | "srcObject" | "play" | "pause"
> & { setSinkId?: (sinkId: string) => Promise<void> };

const owners = new WeakMap<PlaybackElement, symbol>();

/** Start incoming video silently when sound cannot be routed. */
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
  let output: AudioOutputResult | undefined;
  const current = (expected: number) =>
    !disposed && owners.get(element) === owner && revision === expected;
  element.muted = true;
  element.pause();
  element.srcObject = stream;

  const play = async (expected: number) => {
    if (!current(expected)) return;
    const hasAudioOutput = output === "selected" || output === "fallback";
    const silentVideo =
      output === "unavailable" &&
      element.tagName === "VIDEO" &&
      stream.getVideoTracks().some((track) => track.readyState === "live");
    if (!hasAudioOutput && !silentVideo) return;
    element.muted = !hasAudioOutput;
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
      output = undefined;
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
      if (!current(expected)) return;
      output = result;
      await play(expected);
    },
    retry() {
      // A user click can retry an autoplay rejection synchronously, but cannot
      // unmute a failed/pending route or revive a disposed stream.
      return play(revision);
    },
    dispose() {
      disposed = true;
      output = undefined;
      revision++;
      if (owners.get(element) !== owner) return;
      owners.delete(element);
      element.muted = true;
      element.pause();
      element.srcObject = null;
    },
  };
}
