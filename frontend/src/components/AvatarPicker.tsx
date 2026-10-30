import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Camera, Pencil, Upload } from "lucide-react";
import { AvatarEditor } from "./AvatarEditor";
import type { AvatarKind } from "./AvatarEditor";
import { Button, ErrorNotice, Modal } from "./ui";
import "./avatar.css";

/** Photo card and confirmation shared by profile, group settings and group creation. */
export function AvatarPicker({
  file,
  onChange,
  onSave,
  onRemove,
  loadCurrent,
  hasPhoto = false,
  disabled = false,
  label,
  fallback,
  kind = "profile",
  compact = false,
}: {
  file?: File;
  onChange?: (file?: File) => void;
  onSave?: (file: File, signal: AbortSignal) => Promise<void>;
  onRemove?: (signal: AbortSignal) => Promise<void>;
  loadCurrent?: (signal: AbortSignal) => Promise<Blob>;
  hasPhoto?: boolean;
  disabled?: boolean;
  label?: string;
  fallback?: ReactNode;
  kind?: AvatarKind;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState("");
  const [url, setURL] = useState<string>();
  const pending = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!file) {
      setURL(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setURL(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const photo = Boolean(file || hasPhoto);
  const title = kind === "group" ? "Фото группы" : "Фото профиля";
  const open = () => {
    setSaved("");
    setEditing(true);
  };
  async function remove() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    pending.current = controller;
    try {
      if (onRemove) await onRemove(controller.signal);
      else onChange?.(undefined);
      if (!controller.signal.aborted) {
        setRemoving(false);
        setSaved("Фото удалено.");
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      submitting.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const preview = (
    <button
      type="button"
      className={`${compact ? "chat-group-photo" : "avatar-settings-preview"} ${kind === "group" ? "group" : ""}`}
      disabled={disabled}
      aria-label={
        label ||
        `${photo ? "Изменить" : "Добавить"} фото ${kind === "group" ? "группы" : "профиля"}`
      }
      onClick={open}
    >
      <span className="avatar-settings-image">
        {url ? <img src={url} alt="" /> : fallback || <Camera size={30} />}
      </span>
      <span className="avatar-camera" aria-hidden="true">
        <Camera size={15} />
      </span>
    </button>
  );
  return (
    <>
      {compact ? (
        preview
      ) : (
        <section
          className={`avatar-settings ${kind === "profile" ? "profile-avatar-editor" : "group-avatar-editor"}`}
          aria-label={title}
        >
          {preview}
          <div className="avatar-settings-copy">
            <h3>{title}</h3>
            <p>
              {photo
                ? "Настройте кадр или выберите новое фото."
                : kind === "group"
                  ? "Помогите участникам быстрее находить этот чат."
                  : "Добавьте фото, чтобы вас было проще узнать."}
            </p>
            <div className="avatar-settings-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                onClick={open}
              >
                {photo ? <Pencil size={15} /> : <Upload size={15} />}
                {photo ? "Изменить фото" : "Добавить фото"}
              </Button>
              {photo && (onRemove || onChange) && (
                <button
                  type="button"
                  className="avatar-remove-link"
                  disabled={disabled}
                  onClick={() => {
                    setSaved("");
                    setError(undefined);
                    setRemoving(true);
                  }}
                >
                  Удалить
                </button>
              )}
            </div>
            <small>JPG, PNG или WebP · до 5 МБ</small>
          </div>
        </section>
      )}
      {saved && (
        <p
          className={`avatar-save-status ${compact ? "sr-only" : ""}`}
          role="status"
        >
          {saved}
        </p>
      )}
      {editing && (
        <AvatarEditor
          kind={kind}
          loadCurrent={
            file ? async () => file : hasPhoto ? loadCurrent : undefined
          }
          onClose={() => setEditing(false)}
          onSave={async (next, signal) => {
            if (onSave) await onSave(next, signal);
            else onChange?.(next);
            if (!signal.aborted)
              setSaved(
                !onSave
                  ? "Фото выбрано."
                  : kind === "profile"
                    ? "Фото профиля сохранено."
                    : "Фото группы сохранено.",
              );
          }}
        />
      )}
      {removing && (
        <Modal
          title="Удалить фото?"
          className="avatar-delete-modal"
          onClose={() => {
            if (!submitting.current) setRemoving(false);
          }}
        >
          <p className="field-hint">
            Вместо фотографии {kind === "group" ? "группы" : "профиля"} будут
            отображаться инициалы. Вы сможете добавить новое фото в любое время.
          </p>
          <ErrorNotice error={error} />
          <div className="avatar-delete-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={busy}
              onClick={() => void remove()}
            >
              Удалить фото
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
