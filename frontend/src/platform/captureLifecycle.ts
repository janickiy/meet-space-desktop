import { isDesktopBuild } from "./build";
import { desktopBridge } from "./desktop";

/** Capture never survives leaving the document or suspending the desktop. */
export function subscribeCaptureRelease(release: () => void): () => void {
  window.addEventListener("pagehide", release);
  const unsubscribe = isDesktopBuild
    ? desktopBridge().onTransportEvent((event) => {
        if (
          event.kind === "lifecycle" &&
          ["suspend", "quit"].includes(event.type)
        )
          release();
      })
    : () => {};
  return () => {
    window.removeEventListener("pagehide", release);
    unsubscribe();
  };
}
