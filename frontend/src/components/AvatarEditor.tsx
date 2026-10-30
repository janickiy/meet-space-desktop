import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Check, LoaderCircle, Upload, UserRound, Users } from "lucide-react";
import { errorMessage } from "../api";
import {
  avatarCropRect,
  clampAvatarOffset,
  decodeAvatarSource,
  DEFAULT_AVATAR_CROP,
  drawAvatar,
  encodeAvatar,
} from "../avatarImage";
import type { AvatarCrop } from "../avatarImage";
import { Button, Modal } from "./ui";
import "./avatar.css";

export type AvatarKind = "profile" | "group";

/** Shared renderer for Windows, Linux and macOS. No photo leaves the editor before Save. */
export function AvatarEditor({
  kind,
  loadCurrent,
  onSave,
  onClose,
}: {
  kind: AvatarKind;
  loadCurrent?: (signal: AbortSignal) => Promise<Blob>;
  onSave: (file: File, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const pending = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>(DEFAULT_AVATAR_CROP);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    crop: AvatarCrop;
    width: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  async function load(source: (signal: AbortSignal) => Promise<Blob>) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const blob = await source(controller.signal);
      controller.signal.throwIfAborted();
      const next = await decodeAvatarSource(
        new File([blob], "photo", { type: blob.type }),
        controller.signal,
      );
      bitmap.current?.close();
      bitmap.current = next;
      setImage(next);
      setCrop(DEFAULT_AVATAR_CROP);
      drag.current = null;
      setDragging(false);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && !("status" in e) ? e.message : errorMessage(e),
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    if (loadCurrent) void load(loadCurrent);
    return () => {
      pending.current?.abort();
      bitmap.current?.close();
      bitmap.current = null;
    };
    // Parent cache refreshes must not reset an open crop.
  }, []);
  useEffect(() => {
    if (image && canvas.current) drawAvatar(canvas.current, image, crop);
  }, [image, crop]);
  const close = () => {
    if (!saving.current) onClose();
  };
  const rect = image ? avatarCropRect(image.width, image.height, crop) : null;
  function endDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  async function save() {
    if (!image || !canvas.current || saving.current || loading) return;
    saving.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const file = await encodeAvatar(canvas.current, controller.signal);
      await onSave(file, controller.signal);
      if (!controller.signal.aborted) onClose();
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      saving.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === "group" ? "Фото группы" : "Фото профиля"}
      onClose={close}
      className="avatar-editor-modal"
    >
      <div
        className={`avatar-editor ${image ? "has-image" : ""}`}
        aria-busy={loading || busy}
      >
        <div className="avatar-editor-body">
          <div className="avatar-workspace">
            <div className="avatar-crop">
              <canvas
                ref={canvas}
                width={512}
                height={512}
                tabIndex={0}
                role="img"
                aria-label="Область обрезки фотографии. Перетащите фото или используйте стрелки."
                className={dragging ? "dragging" : ""}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !image || busy || loading) return;
                  event.preventDefault();
                  event.currentTarget.focus({ preventScroll: true });
                  drag.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    crop,
                    width: event.currentTarget.getBoundingClientRect().width,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragging(true);
                }}
                onPointerMove={(event) => {
                  const d = drag.current;
                  if (
                    !d ||
                    d.id !== event.pointerId ||
                    !image ||
                    busy ||
                    loading
                  )
                    return;
                  const r = avatarCropRect(image.width, image.height, d.crop),
                    ratio = r.side / d.width;
                  setCrop({
                    ...d.crop,
                    x: r.horizontal
                      ? clampAvatarOffset(
                          d.crop.x +
                            ((event.clientX - d.x) * ratio * 200) /
                              (image.width - r.side),
                        )
                      : 0,
                    y: r.vertical
                      ? clampAvatarOffset(
                          d.crop.y +
                            ((event.clientY - d.y) * ratio * 200) /
                              (image.height - r.side),
                        )
                      : 0,
                  });
                }}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={(event) => {
                  if (
                    !image ||
                    busy ||
                    loading ||
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const key = ["ArrowLeft", "ArrowRight"].includes(event.key)
                    ? "x"
                    : "y";
                  if (!(key === "x" ? rect?.horizontal : rect?.vertical))
                    return;
                  const delta =
                    (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) *
                    (event.shiftKey ? 10 : 2);
                  setCrop((value) => ({
                    ...value,
                    [key]: clampAvatarOffset(value[key] + delta),
                  }));
                }}
              />
              <div className="avatar-crop-guide" aria-hidden="true" />
              {!image && (
                <div className="avatar-placeholder">
                  {loading ? (
                    <LoaderCircle className="spin" />
                  ) : kind === "group" ? (
                    <Users />
                  ) : (
                    <UserRound />
                  )}
                </div>
              )}
            </div>
            <p className="avatar-drag-hint">
              Перетащите фото или используйте ползунки.
            </p>
          </div>
          <div className="avatar-editor-tools">
            <button
              type="button"
              className="avatar-file-choice"
              onClick={() => input.current?.click()}
              disabled={busy || loading}
            >
              <Upload size={18} />
              {loading
                ? "Открываем фото…"
                : image
                  ? "Заменить фото"
                  : "Добавить фото"}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              aria-label="Файл фотографии"
              disabled={busy || loading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void load(async () => file);
              }}
            />
            <p className="avatar-file-note">JPG, PNG или WebP · до 5 МБ</p>
            <div className="avatar-adjustments">
              {(
                [
                  ["zoom", "Масштаб", 1, 3, 0.01],
                  ["x", "По горизонтали", -100, 100, 1],
                  ["y", "По вертикали", -100, 100, 1],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <div key={key}>
                  <label htmlFor={`${id}-${key}`}>
                    {label}
                    <output htmlFor={`${id}-${key}`}>
                      {Math.round(key === "zoom" ? crop.zoom * 100 : crop[key])}
                      %
                    </output>
                  </label>
                  <input
                    id={`${id}-${key}`}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={crop[key]}
                    disabled={
                      !image ||
                      busy ||
                      loading ||
                      (key === "x" && !rect?.horizontal) ||
                      (key === "y" && !rect?.vertical)
                    }
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setCrop((previous) => ({ ...previous, [key]: value }));
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="avatar-reset"
                disabled={!image || busy || loading}
                onClick={() => setCrop(DEFAULT_AVATAR_CROP)}
              >
                Сбросить
              </button>
            </div>
          </div>
          {error && (
            <p className="avatar-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="avatar-editor-footer">
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Отмена
            </Button>
            <Button
              type="button"
              busy={busy}
              disabled={!image || loading}
              onClick={() => void save()}
            >
              <Check size={17} />
              Сохранить фото
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
