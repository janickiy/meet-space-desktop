import { useHiddenChatMessages } from "../hiddenChatMessages";
import { useEffect, useId, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  MessageCircle,
  Video,
} from "lucide-react";
import { ApiError, personalChatAPI } from "../api";
import { useAuth } from "../auth";
import { ExternalLink } from "./ExternalLink";
import { safeRecordingUrl } from "../recordingPresentation";
import { formatBytes, mergeChatPages } from "../collaboration";
import { formatDate } from "../utils";
import { isDesktopBuild } from "../platform/build";
import { serviceOrigin } from "../platform/urls";
import type { ChatAttachment } from "../types";
import { NativeSaveButton } from "./desktop/NativeAssets";
import { Button, ErrorNotice } from "./ui";

const materialTabs = [
  {
    id: "media",
    label: "Медиа",
    icon: ImageIcon,
    empty: "Здесь появятся фото и видео из переписки.",
  },
  {
    id: "files",
    label: "Файлы",
    icon: FileText,
    empty: "В этой переписке пока нет файлов.",
  },
  {
    id: "links",
    label: "Ссылки",
    icon: LinkIcon,
    empty: "В этой переписке пока нет ссылок.",
  },
] as const;

export function ConversationFiles({
  conversationId,
  onAccessDenied,
  onShowMessage,
  requireAuthenticated = false,
  title,
}: {
  conversationId: string;
  onAccessDenied: () => void;
  onShowMessage: (id: string) => void;
  requireAuthenticated?: boolean;
  title?: string;
}) {
  const [tab, setTab] = useState<(typeof materialTabs)[number]>(
    materialTabs[0],
  );
  const tabId = useId();
  const { user } = useAuth();
  const { hidden } = useHiddenChatMessages(
    user?.id,
    "conversation",
    conversationId,
  );
  const query = useInfiniteQuery({
    queryKey: ["personal-chat", conversationId, user?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      personalChatAPI.messages(conversationId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !!user,
    refetchOnMount: "always",
    retry: false,
  });
  const denied =
    query.error instanceof ApiError && [403, 404].includes(query.error.status);
  useEffect(() => {
    if (denied) onAccessDenied();
  }, [denied, onAccessDenied]);
  const messages = query.isError
    ? []
    : mergeChatPages(query.data?.pages || [])
        .reverse()
        .filter((message) => !message.deletedAt && !hidden.has(message.id));
  const links =
    tab.id !== "links"
      ? []
      : messages.flatMap((message) => {
          const addresses = new Set<string>();
          for (const match of message.text.matchAll(
            /(?:https?:\/\/|\bwww\.)[^\s<>"'«»]+/gi,
          )) {
            let value = match[0].replace(/[.,!?;:…\]}]+$/u, "");
            while (
              value.endsWith(")") &&
              value.split(")").length > value.split("(").length
            )
              value = value.slice(0, -1);
            const url = safeRecordingUrl(
              /^www\./i.test(value) ? `https://${value}` : value,
            );
            if (url) addresses.add(url);
          }
          return [...addresses].map((url) => ({ url, message }));
        });
  const files = messages.flatMap((message) =>
    message.attachments
      .filter((file) =>
        tab.id === "media"
          ? /^(image|video)\//i.test(file.mimeType)
          : tab.id === "files" && !/^(image|video)\//i.test(file.mimeType),
      )
      .map((file) => ({ file, message })),
  );
  const jump = (id: string, label: string) => (
    <button
      type="button"
      className="icon-button"
      title="Показать в переписке"
      aria-label={`Показать в переписке: ${label}`}
      onClick={() => onShowMessage(id)}
    >
      <MessageCircle size={17} />
    </button>
  );
  return (
    <section
      className="chat-info-card chat-info-materials"
      aria-label="Материалы переписки"
    >
      {title && <h3>{title}</h3>}
      <div
        className="chat-material-tabs"
        role="tablist"
        aria-label="Материалы переписки"
      >
        {materialTabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${tabId}-${item.id}`}
            aria-selected={item.id === tab.id}
            tabIndex={item.id === tab.id ? 0 : -1}
            aria-controls={`${tabId}-panel`}
            onClick={() => setTab(item)}
            onKeyDown={(event) => {
              const target = {
                ArrowLeft: (index + 2) % 3,
                ArrowRight: (index + 1) % 3,
                Home: 0,
                End: 2,
              }[event.key];
              if (target === undefined) return;
              event.preventDefault();
              setTab(materialTabs[target]);
              document
                .getElementById(`${tabId}-${materialTabs[target].id}`)
                ?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="chat-profile-files"
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab.id}`}
        tabIndex={0}
      >
        <ErrorNotice error={query.error} />
        {query.isPending && <p role="status">Загружаем материалы…</p>}
        {query.isError && !denied && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            Повторить загрузку
          </Button>
        )}
        {!query.isPending &&
          !query.isError &&
          !files.length &&
          !links.length && (
            <div className="chat-profile-empty">
              <tab.icon size={24} aria-hidden="true" />
              <p>{tab.empty}</p>
            </div>
          )}
        <ul
          className={`chat-profile-file-list ${tab.id === "media" ? "chat-info-media" : ""}`}
        >
          {links.map(({ url, message }) => (
            <li className="chat-profile-file" key={message.id + url}>
              <span className="chat-profile-file-icon">
                <LinkIcon size={18} />
              </span>
              <span className="chat-profile-file-copy">
                <ExternalLink href={url}>{url}</ExternalLink>
                <small>
                  {message.senderName} · {formatDate(message.createdAt)}
                </small>
              </span>
              {jump(message.id, url)}
            </li>
          ))}
          {files.map(({ file, message }) => (
            <li key={file.id} className="chat-profile-file">
              {tab.id === "media" ? (
                <MediaPreview
                  conversationId={conversationId}
                  file={file}
                  onShow={() => onShowMessage(message.id)}
                />
              ) : (
                <span className="chat-profile-file-icon">
                  <FileText size={20} aria-hidden="true" />
                </span>
              )}
              <span className="chat-profile-file-copy">
                <strong>{file.filename}</strong>
                <small>
                  {formatBytes(file.size)} · {formatDate(message.createdAt)}
                </small>
              </span>
              {tab.id === "files" && jump(message.id, file.filename)}
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
    </section>
  );
}

function MediaPreview({
  conversationId,
  file,
  onShow,
}: {
  conversationId: string;
  file: ChatAttachment;
  onShow: () => void;
}) {
  const preview = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState("");
  useEffect(() => {
    setSource("");
    if (
      !preview.current ||
      !/^image\/(png|jpeg|gif|webp|avif)$/i.test(file.mimeType) ||
      file.size > 10 * 1024 * 1024
    )
      return;
    const controller = new AbortController();
    let local = "";
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void personalChatAPI
        .attachmentContent(conversationId, file.id, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return;
          local = URL.createObjectURL(blob);
          setSource(local);
        })
        .catch(() => {});
    });
    observer.observe(preview.current);
    return () => {
      observer.disconnect();
      controller.abort();
      if (local) URL.revokeObjectURL(local);
    };
  }, [conversationId, file.id, file.mimeType, file.size]);
  return (
    <button
      ref={preview}
      className="chat-material-preview"
      type="button"
      onClick={onShow}
      aria-label={`Показать в переписке: ${file.filename}`}
    >
      {source ? (
        <img src={source} alt="" onError={() => setSource("")} />
      ) : file.mimeType.startsWith("video/") ? (
        <Video />
      ) : (
        <ImageIcon />
      )}
    </button>
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
