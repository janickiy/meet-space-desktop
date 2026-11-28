import { useRef } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { loadRecordingLibraryPage } from "../recordingLibrary";
import { recordingDate } from "../recordingPresentation";
import type { ConferenceRecording, Items } from "../types";
import { Button, ErrorNotice, Modal } from "./ui";

export function DeleteRecordingDialog({
  record,
  title,
  onClose,
  returnFocus,
}: {
  record: ConferenceRecording;
  title: string;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const submitting = useRef(false);
  const { conferenceId, uuid } = record;
  const mutation = useMutation({
    mutationFn: () => api.deleteRecording(conferenceId, uuid),
    onError: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      const catalogueKey = ["recording-library", user?.id];
      const historyKey = ["history-recording-library", conferenceId];
      const listKey = ["recordings", conferenceId];
      const detailKey = ["recording-detail", user?.id, conferenceId, uuid];
      const keys = [catalogueKey, historyKey, listKey, detailKey];
      await Promise.all(
        keys.map((queryKey) => client.cancelQueries({ queryKey })),
      );

      const withoutRecord = (page: Items<ConferenceRecording>) => ({
        ...page,
        items: page.items.filter((item) => item.uuid !== uuid),
      });
      client.setQueriesData<
        InfiniteData<Awaited<ReturnType<typeof loadRecordingLibraryPage>>>
      >(
        { queryKey: catalogueKey },
        (cached) =>
          cached && {
            ...cached,
            pages: cached.pages.map((page) => ({
              ...page,
              entries: page.entries.filter(
                (entry) =>
                  entry.conference.id !== conferenceId ||
                  entry.record.uuid !== uuid,
              ),
            })),
          },
      );
      client.setQueryData<InfiniteData<Items<ConferenceRecording>>>(
        historyKey,
        (cached) =>
          cached && { ...cached, pages: cached.pages.map(withoutRecord) },
      );
      client.setQueryData<Items<ConferenceRecording>>(
        listKey,
        (cached) => cached && withoutRecord(cached),
      );
      client.removeQueries({ queryKey: detailKey, exact: true });
      // Обновляем смещения страниц после исключения записи.
      for (const queryKey of [
        catalogueKey,
        historyKey,
        listKey,
        ["history", conferenceId],
        ["recording-detail-history", user?.id, conferenceId],
      ]) {
        void client.invalidateQueries({ queryKey });
      }
      onClose();
    },
  });

  const error = mutation.error;
  const explanation =
    error instanceof ApiError &&
    (error.status === 403
      ? "У вас больше нет доступа к удалению этой записи."
      : error.status === 409 &&
          error.message !== "Аккаунт изменился. Повторите действие."
        ? "Запись ещё обрабатывается. Попробуйте позже."
        : undefined);

  function cancel() {
    if (!submitting.current) onClose();
  }

  function confirm() {
    if (submitting.current) return;
    submitting.current = true;
    mutation.mutate();
  }

  return (
    <Modal
      title="Удалить запись?"
      className="recordings-delete-dialog"
      onClose={cancel}
      returnFocus={returnFocus}
    >
      <p>
        <strong>{title}</strong> · {recordingDate(record)}
      </p>
      <p>
        Запись и её файлы будут удалены для всех участников встречи.
        Восстановить их будет невозможно.
      </p>
      <ErrorNotice error={error}>{explanation || null}</ErrorNotice>
      <div className="recordings-delete-buttons">
        <Button
          type="button"
          variant="outline"
          data-autofocus
          disabled={mutation.isPending}
          onClick={cancel}
        >
          Отмена
        </Button>
        <Button
          type="button"
          variant="danger"
          busy={mutation.isPending}
          onClick={confirm}
        >
          {mutation.isPending ? "Удаляем…" : "Удалить запись"}
        </Button>
      </div>
    </Modal>
  );
}
