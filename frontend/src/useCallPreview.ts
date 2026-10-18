import { subscribeCaptureRelease } from "./platform/captureLifecycle";
import { useEffect, useState } from "react";
import { captureErrorMessage } from "./prejoinDevices";
import {
  captureWithDeviceFallback,
  inputTrackConstraints,
} from "./mediaDevices";

/** Local-only preview. Each effect owns its tracks, including late permission results. */
export function useCallPreview(
  kind: "audio" | "video",
  enabled: boolean,
  deviceId: string,
  noiseSuppression: boolean,
  onUnavailable: () => void,
) {
  const [stream, setStream] = useState<MediaStream>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setStream(undefined);
    setLoading(enabled);
    if (!enabled) return;
    let disposed = false;
    let owned: MediaStream | undefined;
    const ended = () => {
      if (!disposed) onUnavailable();
    };
    const capture = async () => {
      setError("");
      try {
        const constraints = (preferred: string): MediaStreamConstraints => ({
          audio:
            kind === "audio" &&
            inputTrackConstraints(kind, preferred, noiseSuppression),
          video:
            kind === "video" &&
            inputTrackConstraints(kind, preferred, noiseSuppression),
        });
        const captured = await captureWithDeviceFallback(
          constraints(deviceId),
          deviceId ? constraints("") : undefined,
          () => !disposed,
        );
        if (!captured) return;
        owned = captured.stream;
        if (disposed) {
          owned.getTracks().forEach((track) => track.stop());
          return;
        }
        owned
          .getTracks()
          .forEach((track) => track.addEventListener("ended", ended));
        setStream(owned);
      } catch (cause) {
        if (!disposed) {
          setError(captureErrorMessage(cause, kind));
          onUnavailable();
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    const release = () => {
      disposed = true;
      owned?.getTracks().forEach((track) => {
        track.removeEventListener("ended", ended);
        track.stop();
      });
    };
    const unsubscribeRelease = subscribeCaptureRelease(() => {
      release();
      setStream(undefined);
      setLoading(false);
      onUnavailable();
    });
    void capture();
    return () => {
      release();
      unsubscribeRelease();
    };
  }, [kind, enabled, deviceId, noiseSuppression, onUnavailable]);
  return {
    stream: enabled ? stream : undefined,
    error,
    loading: enabled && loading,
  };
}
