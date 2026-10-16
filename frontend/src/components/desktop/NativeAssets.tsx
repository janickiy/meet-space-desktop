import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { getAccessToken, subscribeAccessToken } from "../../api";
import { nativeAssetRequest } from "../../platform/assets";
import type {
  AssetProgress,
  NativeRecordingMedia,
} from "../../platform/assets";
import type { DesktopAsset } from "../../platform/desktop-contracts";
import { formatRecordingSize } from "../../recordingPresentation";

/** Cancels pending work and revokes playback on identity, resource or page changes. */
export function useNativeAsset(identity: string) {
  const token = useSyncExternalStore(
    subscribeAccessToken,
    getAccessToken,
    getAccessToken,
  );
  const controller = useRef<AbortController | null>(null);
  const opened = useRef<NativeRecordingMedia | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AssetProgress>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<string>();
  const dispose = () => {
    controller.current?.abort();
    controller.current = null;
    opened.current?.close();
    opened.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    setSource(undefined);
    setBusy(false);
    setProgress(undefined);
    setError("");
    setNotice("");
    return () => {
      mounted.current = false;
      dispose();
    };
  }, [identity, token]);
  const run = async (asset: DesktopAsset, mode: "save" | "play") => {
    if (controller.current || !token) return;
    opened.current?.close();
    opened.current = null;
    setSource(undefined);
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(undefined);
    try {
      const result = await nativeAssetRequest(
        asset,
        token,
        mode,
        current.signal,
        (value) => {
          if (mounted.current && controller.current === current)
            setProgress(value);
        },
      );
      if (
        !mounted.current ||
        current.signal.aborted ||
        controller.current !== current
      ) {
        if ("close" in result) result.close();
        return;
      }
      if ("close" in result) {
        opened.current = result;
        setSource(result.url);
      } else if (result.saved) setNotice("Файл сохранён");
    } catch {
      if (
        mounted.current &&
        !current.signal.aborted &&
        controller.current === current
      )
        setError(
          mode === "play"
            ? "Не удалось открыть запись. Проверьте доступ и подключение к серверу, затем повторите попытку."
            : "Не удалось сохранить файл. Проверьте доступ, свободное место и подключение к серверу.",
        );
    } finally {
      if (mounted.current && controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    dispose();
    setBusy(false);
    setProgress(undefined);
    setSource(undefined);
  };
  return { busy, progress, error, notice, source, run, cancel };
}

export function NativeAssetStatus({
  operation,
}: {
  operation: ReturnType<typeof useNativeAsset>;
}) {
  return (
    <>
      {operation.busy && (
        <span role="status">
          {operation.progress
            ? `Загружено ${formatRecordingSize(operation.progress.received)}${operation.progress.total ? ` из ${formatRecordingSize(operation.progress.total)}` : ""}`
            : "Подготовка файла…"}{" "}
          <button
            type="button"
            className="text-link"
            onClick={operation.cancel}
          >
            Отменить
          </button>
        </span>
      )}
      {operation.error && <span role="alert">{operation.error}</span>}
      {operation.notice && <span role="status">{operation.notice}</span>}
    </>
  );
}

/** The native save dialog appears only after this explicit action. */
export function NativeSaveButton({
  asset,
  children,
  ...props
}: {
  asset: DesktopAsset;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const operation = useNativeAsset(JSON.stringify(asset));
  return (
    <>
      <button
        {...props}
        type="button"
        disabled={props.disabled || operation.busy}
        onClick={(event) => {
          props.onClick?.(event);
          if (!event.defaultPrevented) void operation.run(asset, "save");
        }}
      >
        {children}
      </button>
      <NativeAssetStatus operation={operation} />
    </>
  );
}
