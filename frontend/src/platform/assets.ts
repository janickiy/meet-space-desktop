import { isDesktopBuild } from "./build";
import { desktopBridge } from "./desktop";
import type { DesktopAsset, DesktopAssetRequest } from "./desktop-contracts";

export type AssetProgress = { received: number; total?: number };
export type NativeRecordingMedia = {
  url: string;
  mimeType: string;
  close: () => void;
};

/** Only stable server IDs cross IPC. Signed URLs and filesystem paths stay in main. */
export async function nativeAssetRequest(
  asset: DesktopAsset,
  token: string,
  mode: "save" | "play",
  signal: AbortSignal,
  onProgress?: (value: AssetProgress) => void,
): Promise<{ cancelled: boolean; saved: boolean } | NativeRecordingMedia> {
  if (!isDesktopBuild || !token) throw new Error("asset_unavailable");
  signal.throwIfAborted();
  if (mode === "play" && asset.kind !== "recording")
    throw new Error("asset_unavailable");
  const bridge = desktopBridge();
  const request: DesktopAssetRequest = {
    id: crypto.randomUUID(),
    token,
    asset,
  };
  const close = () => {
    void bridge.cancelAsset(request.id).catch(() => {});
    if (mode === "play")
      void bridge.closeRecordingMedia(request.id).catch(() => {});
  };
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    close();
    rejectAbort(new DOMException("Request aborted", "AbortError"));
  };
  const unsubscribe = bridge.onTransportEvent((event) => {
    if (
      !signal.aborted &&
      event.kind === "asset" &&
      event.id === request.id &&
      Number.isFinite(event.received) &&
      event.received >= 0
    )
      onProgress?.({
        received: event.received,
        ...(typeof event.total === "number" &&
        Number.isFinite(event.total) &&
        event.total >= event.received
          ? { total: event.total }
          : {}),
      });
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (mode === "save") {
      const result = await Promise.race([bridge.saveAsset(request), aborted]);
      signal.throwIfAborted();
      if (
        typeof result?.saved !== "boolean" ||
        typeof result.cancelled !== "boolean"
      )
        throw new Error("invalid_asset_response");
      return result;
    }
    const pending = bridge.openRecordingMedia(request).then((result) => {
      if (signal.aborted) close();
      return result;
    });
    const result = await Promise.race([pending, aborted]);
    signal.throwIfAborted();
    if (
      result.id !== request.id ||
      !/^app:\/\/meetspace\/native-media\/[A-Za-z0-9_-]{43}$/.test(
        result.url,
      ) ||
      ![
        "video/mp4",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/webm",
        "audio/wav",
        "image/jpeg",
      ].includes(result.mimeType)
    ) {
      close();
      throw new Error("invalid_asset_response");
    }
    return { url: result.url, mimeType: result.mimeType, close };
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}
