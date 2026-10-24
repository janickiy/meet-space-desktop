import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, FileText, Files } from "lucide-react";
import { ApiError, personalChatAPI } from "../api";
import { useAuth } from "../auth";
import { formatBytes } from "../collaboration";
import { formatDate } from "../utils";
import { isDesktopBuild } from "../platform/build";
import { serviceOrigin } from "../platform/urls";
import type { ChatAttachment } from "../types";
import { NativeSaveButton } from "./desktop/NativeAssets";
import { Button, ErrorNotice } from "./ui";

/** Reads the caller's visible conversation history; deleted messages never provide files. */
export function ConversationFiles({
  conversationId,
  onAccessDenied,
  requireAuthenticated = false,
}: {
  conversationId: string;
  onAccessDenied: () => void;
  requireAuthenticated?: boolean;
}) {
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ["personal-profile-files", user?.id, conversationId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      personalChatAPI.messages(conversationId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !!user,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const denied =
    query.error instanceof ApiError && [403, 404].includes(query.error.status);
  useEffect(() => {
    if (denied) onAccessDenied();
  }, [denied, onAccessDenied]);
  const files = !query.isError
    ? [
        ...new Map(
          (query.data?.pages.flatMap((page) => page.items) || [])
            .filter((message) => !message.deletedAt)
            .flatMap((message) =>
              message.attachments.map(
                (file) =>
                  [file.id, { file, createdAt: message.createdAt }] as const,
              ),
            ),
        ).values(),
      ]
    : [];
  return (
    <div className="chat-profile-files">
      <ErrorNotice error={query.error} />
      {query.isPending && <p role="status">Загружаем файлы…</p>}
      {query.isError && !denied && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Повторить загрузку
        </Button>
      )}
      {!query.isPending && !query.isError && !files.length && (
        <div className="chat-profile-empty">
          <Files size={32} aria-hidden="true" />
          <h3>Файлы пока не найдены</h3>
          <p>
            {query.hasNextPage
              ? "Проверьте более ранние сообщения."
              : "Здесь появятся документы, изображения и другие вложения переписки."}
          </p>
        </div>
      )}
      <ul className="chat-profile-file-list">
        {files.map(({ file, createdAt }) => (
          <li key={file.id} className="chat-profile-file">
            <span className="chat-profile-file-icon">
              <FileText size={20} aria-hidden="true" />
            </span>
            <span className="chat-profile-file-copy">
              <strong>{file.filename}</strong>
              <small>
                {formatBytes(file.size)} · {formatDate(createdAt)}
              </small>
            </span>
            {isDesktopBuild ? (
              <NativeSaveButton
                asset={{
                  kind: "attachment",
                  scope: "conversation",
                  scopeId: conversationId,
                  attachmentId: file.id,
                  filename: file.filename,
                }}
                className="icon-button"
                aria-label={`Скачать файл: ${file.filename}`}
              >
                <Download size={17} aria-hidden="true" />
              </NativeSaveButton>
            ) : (
              <BrowserFileDownload
                file={file}
                conversationId={conversationId}
                requireAuthenticated={requireAuthenticated}
              />
            )}
          </li>
        ))}
      </ul>
      {query.hasNextPage && !query.isError && (
        <Button
          variant="outline"
          busy={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Загрузить более ранние сообщения
        </Button>
      )}
    </div>
  );
}

function BrowserFileDownload({
  file,
  conversationId,
  requireAuthenticated,
}: {
  file: ChatAttachment;
  conversationId: string;
  requireAuthenticated: boolean;
}) {
  const [download, setDownload] = useState<{
    url: string;
    expiresAt: string;
  }>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!download) return;
    const timer = window.setTimeout(
      () => setDownload(undefined),
      Math.max(0, Date.parse(download.expiresAt) - Date.now() - 5000),
    );
    return () => {
      window.clearTimeout(timer);
      if (download.url.startsWith("blob:")) URL.revokeObjectURL(download.url);
    };
  }, [download]);
  const prepare = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(false);
    try {
      const result = await personalChatAPI.attachmentDownload(
        conversationId,
        file.id,
      );
      controller.signal.throwIfAborted();
      const url = new URL(result.url, serviceOrigin());
      if (requireAuthenticated && result.authenticated !== true)
        throw new Error("private_attachment_required");
      if (result.authenticated === true) {
        const path = `/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.id)}/content`;
        if (
          url.origin !== serviceOrigin() ||
          url.pathname !== path ||
          url.search ||
          url.hash
        )
          throw new Error("invalid_private_file_url");
        const blob = await personalChatAPI.attachmentContent(
          conversationId,
          file.id,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        setDownload({
          url: URL.createObjectURL(blob),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      } else {
        if (
          !["http:", "https:"].includes(url.protocol) ||
          !Number.isFinite(Date.parse(result.expiresAt))
        )
          throw new Error("invalid_download_url");
        setDownload({ url: url.toString(), expiresAt: result.expiresAt });
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <>
      {download ? (
        <a
          className="icon-button"
          href={download.url}
          download={file.filename}
          target="_blank"
          rel="noreferrer"
          aria-label={`Скачать файл: ${file.filename}`}
        >
          <Download size={17} aria-hidden="true" />
        </a>
      ) : (
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={`Подготовить файл: ${file.filename}`}
          onClick={() => void prepare()}
        >
          <Download size={17} aria-hidden="true" />
        </button>
      )}
      {error && <span role="alert">Не удалось подготовить файл.</span>}
    </>
  );
}
