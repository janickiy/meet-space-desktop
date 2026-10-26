import { isDesktopBuild } from "./platform/build";
import { desktopBridge } from "./platform/desktop";
import { desktopServerID } from "./platform/urls";
import toneURL from "./assets/device-tone.wav";
import { routeAudioOutput } from "./mediaDevices";
import {
  readDevicePreferences,
  subscribeDevicePreferences,
} from "./prejoinDevices";

/** One reusable player per account stream; no microphone or browser push permission. */
export function createNotificationSound(userId: string) {
  const profileId = isDesktopBuild ? desktopServerID() : null;
  const currentAccount = () =>
    !isDesktopBuild || (!!profileId && desktopServerID() === profileId);
  const audio = new Audio(toneURL);
  audio.preload = "auto";
  audio.volume = 0.35;
  let disposed = false;
  let unlocked = false;
  let priming: Promise<void> | undefined;
  let lastPlayedAt = -Infinity;
  let playbackRevision = 0;
  let soundPreferences = readDevicePreferences(userId);
  const seen = new Set<string>();
  const claimKey = `meet.notification-sound.v1:${profileId ? `${profileId}:` : ""}${userId}`;

  // A muted, user-initiated play unlocks this same element when the browser
  // requires interaction. Old notifications are never queued for a later click.
  const prime = () => {
    if (
      disposed ||
      !currentAccount() ||
      unlocked ||
      priming ||
      !readDevicePreferences(userId).notificationSounds
    )
      return;
    audio.muted = true;
    priming = audio
      .play()
      .then(() => {
        if (disposed) return;
        audio.pause();
        audio.currentTime = 0;
        unlocked = true;
      })
      .catch(() => {})
      .finally(() => {
        audio.muted = false;
        priming = undefined;
      });
  };
  window.addEventListener("pointerdown", prime);
  window.addEventListener("keydown", prime);
  const unsubscribe = subscribeDevicePreferences(userId, (preferences) => {
    if (
      preferences.notificationOutputId !==
        soundPreferences.notificationOutputId ||
      preferences.notificationSounds !== soundPreferences.notificationSounds
    )
      playbackRevision++;
    soundPreferences = preferences;
    if (!preferences.notificationSounds) audio.pause();
  });

  const claim = (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 128) seen.delete(seen.values().next().value!);
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(claimKey) || "[]");
      const recent = (Array.isArray(raw) ? raw : []).filter(
        (item): item is { id: string; at: number } =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.at === "number" &&
          item.at > Date.now() - 120000,
      );
      if (recent.some((item) => item.id === id)) return false;
      localStorage.setItem(
        claimKey,
        JSON.stringify([...recent.slice(-127), { id, at: Date.now() }]),
      );
    } catch {
      // The per-stream identity window still works with private/disabled storage.
    }
    return true;
  };
  const play = async (id: string) => {
    const preferences = readDevicePreferences(userId);
    if (
      disposed ||
      !currentAccount() ||
      !preferences.notificationSounds ||
      !claim(id)
    )
      return;
    // Coalesce bursts into one soft signal; all notices remain in the feed.
    if (Date.now() - lastPlayedAt < 1000) return;
    lastPlayedAt = Date.now();
    if (priming) await priming;
    if (disposed || !readDevicePreferences(userId).notificationSounds) return;
    const sinkId = readDevicePreferences(userId).notificationOutputId;
    const revision = playbackRevision;
    const isCurrent = () => {
      const current = readDevicePreferences(userId);
      return (
        !disposed &&
        currentAccount() &&
        revision === playbackRevision &&
        current.notificationSounds &&
        current.notificationOutputId === sinkId
      );
    };
    const readDevices =
      typeof navigator.mediaDevices?.enumerateDevices === "function"
        ? () => navigator.mediaDevices.enumerateDevices()
        : undefined;
    const routed = await routeAudioOutput(
      audio,
      sinkId,
      isCurrent,
      readDevices,
    );
    if (routed === "unavailable" || routed === "superseded") return;
    if (!isCurrent()) return;
    audio.currentTime = 0;
    await audio.play().catch(() => {});
  };
  const notify = (id: string) => {
    if (!id || id.length > 128 || disposed) return;
    // Serializing claims prevents the same SSE event ringing in several tabs.
    const pending = navigator.locks
      ? navigator.locks.request(claimKey, () => play(id))
      : play(id);
    void pending.catch(() => {});
  };
  // Only the native broker may authorize desktop audio. The renderer SSE also
  // carries muted/read/active-chat events and must never ring independently.
  const unsubscribeNative = isDesktopBuild
    ? desktopBridge().onTransportEvent((event) => {
        if (
          event.kind === "notification-sound" &&
          event.profileId === profileId &&
          event.userId === userId
        )
          notify(event.id);
      })
    : undefined;
  return {
    notify: isDesktopBuild ? (_id: string) => {} : notify,
    dispose() {
      disposed = true;
      unsubscribeNative?.();
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
      unsubscribe();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}
