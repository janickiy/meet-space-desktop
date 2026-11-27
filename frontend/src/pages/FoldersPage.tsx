import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  MessageCircle,
  Users,
  Video,
  Folder,
  FolderPlus,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  folderAccessDenied,
  invalidateFolders,
  purgeFolder,
  updateFolder,
  updateFolderMapping,
  useFolderRequest,
  useFolderVisibility,
} from "../folders";
import type { FolderItem, FolderItemFilters, PersonalFolder } from "../types";
import { Button, ErrorNotice } from "../components/ui";
import { MessagingSkeleton } from "../components/MessagingSkeleton";
import { ItemActions } from "../components/ItemActions";
import { FolderManageModal } from "../components/FolderModals";
import { FolderPicker } from "../components/FolderPicker";
import {
  FolderItemLabel,
  FolderItemPicker,
  folderItemHref,
  folderItemName,
  folderItemTarget,
} from "../components/FolderItems";
import "./folders-page.css";
import "./collections-redesign.css";
import "./folder-library.css";
import {
  CollectionViewToggle,
  type CollectionView,
} from "./CollectionViewToggle";

type Management = {
  mode: "create" | "rename" | "delete";
  folder?: PersonalFolder;
};
export function FoldersPage() {
  const { id } = useParams();
  const { user } = useAuth();
  return id ? (
    <FolderDetail key={`${user?.id}:${id}`} id={id} />
  ) : (
    <FolderList key={user?.id} />
  );
}
function FolderArtwork() {
  return (
    <span className="pf-folder-art" aria-hidden="true">
      <i className="pf-paper" />
      <i className="pf-cover" />
    </span>
  );
}

const folderPlurals = new Intl.PluralRules("ru");
function folderSummary(folder: PersonalFolder) {
  const count = (n: number, forms: Record<string, string>) =>
    n ? `${n} ${forms[folderPlurals.select(n)] || forms.many}` : "";
  const conversations = count(folder.conversationCount, {
    one: "чат",
    few: "чата",
    many: "чатов",
  });
  const conferences = count(folder.conferenceCount, {
    one: "встреча",
    few: "встречи",
    many: "встреч",
  });
  return (
    [conversations, conferences].filter(Boolean).join(" · ") || "Папка пуста"
  );
}

function FolderCardPreview({
  folder,
  userId,
}: {
  folder: PersonalFolder;
  userId: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "100px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const preview = useInfiniteQuery({
    queryKey: ["folder-items", userId, folder.id, "card-preview"],
    enabled: inView,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal }) =>
      api.folderItems(folder.id, { type: "all" }, undefined, signal, 2),
    getNextPageParam: () => undefined,
    staleTime: 15000,
    refetchInterval: inView ? 15000 : false,
    retry: (count, error) => !folderAccessDenied(error) && count < 1,
  });
  const items = preview.isError
    ? []
    : preview.data?.pages[0]?.items.slice(0, 2) || [];
  return (
    <span ref={anchor} className="pf-preview-anchor">
      {items.length > 0 && (
        <span className="pf-card-preview">
          {items.map((entry) => {
            const Icon =
              entry.type === "conference"
                ? Video
                : entry.item.type === "group"
                  ? Users
                  : MessageCircle;
            return (
              <span
                className="pf-preview-line"
                key={entry.type + entry.item.id}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{folderItemName(entry)}</span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
function FolderList() {
  const { user } = useAuth();
  const client = useQueryClient();
  const request = useFolderRequest();
  const visible = useFolderVisibility();
  const gate = useRef(false);
  const [manage, setManage] = useState<Management | null>(null);
  const [layout, setLayout] = useState<CollectionView>("grid");
  const list = useQuery({
    queryKey: ["folders", user?.id],
    queryFn: ({ signal }) => api.folders(undefined, signal),
    refetchInterval: visible ? 15000 : false,
  });
  const items = list.data?.items || [];
  const order = useMutation({
    mutationFn: (ids: string[]) => api.orderFolders(ids, request.signal()),
    onSuccess: ({ items }) => {
      if (!request.mounted.current || !user) return;
      client.setQueryData(["folders", user.id], { status: "success", items });
      void invalidateFolders(client, user.id);
    },
    onSettled: () => {
      gate.current = false;
    },
  });
  function move(index: number, step: number) {
    if (gate.current) return;
    const next = items.map((folder) => folder.id);
    [next[index], next[index + step]] = [next[index + step], next[index]];
    gate.current = true;
    order.mutate(next);
  }
  return (
    <section className="pf-page" aria-label="Папки">
      <header className="pf-collection-heading">
        <div>
          <h2>Мои папки</h2>
          <p>
            <LockKeyhole aria-hidden="true" />
            Видны только вам
          </p>
        </div>
        <div className="pf-collection-actions">
          <Button
            disabled={items.length >= 100}
            onClick={() => setManage({ mode: "create" })}
          >
            <Plus size={18} aria-hidden="true" />
            Новая папка
          </Button>
          <CollectionViewToggle
            value={layout}
            onChange={setLayout}
            label="Вид папок"
          />
        </div>
      </header>
      <ErrorNotice error={list.error || order.error} />
      {list.isError && (
        <Button variant="outline" onClick={() => void list.refetch()}>
          Повторить загрузку
        </Button>
      )}
      {list.isPending && <MessagingSkeleton />}
      <div
        className="pf-folder-grid"
        data-view={layout}
        aria-busy={order.isPending || undefined}
      >
        {items.map((folder, index) => (
          <article
            className="pf-card"
            key={folder.id}
            data-tone={["lilac", "mint", "honey"][folder.position % 3]}
          >
            <Link to={`/folders/${folder.id}`} className="pf-card-open">
              <span className="pf-card-art">
                <FolderArtwork />
              </span>
              <span className="pf-card-body">
                <strong>{folder.name}</strong>
                <small>{folderSummary(folder)}</small>
                {layout === "grid" && folder.itemCount > 0 && user && (
                  <FolderCardPreview folder={folder} userId={user.id} />
                )}
              </span>
            </Link>
            <div className="pf-card-menu">
              <ItemActions
                label={`Действия с папкой: ${folder.name}`}
                actions={[
                  {
                    label: "Переместить выше",
                    icon: <ArrowUp size={18} aria-hidden="true" />,
                    disabled: index === 0 || order.isPending,
                    run: () => move(index, -1),
                  },
                  {
                    label: "Переместить ниже",
                    icon: <ArrowDown size={18} aria-hidden="true" />,
                    disabled: index === items.length - 1 || order.isPending,
                    run: () => move(index, 1),
                  },
                  {
                    label: "Переименовать",
                    icon: <Pencil size={18} aria-hidden="true" />,
                    run: () => setManage({ mode: "rename", folder }),
                    disabled: order.isPending,
                  },
                  {
                    label: "Удалить папку",
                    icon: <Trash2 size={18} aria-hidden="true" />,
                    run: () => setManage({ mode: "delete", folder }),
                    danger: true,
                    disabled: order.isPending,
                  },
                ]}
              />
            </div>
          </article>
        ))}
      </div>
      {!list.isPending && !list.isError && !items.length && (
        <div className="folder-empty">
          <FolderPlus size={48} aria-hidden="true" />
          <h2>У вас пока нет папок</h2>
          <p>Создайте папку и добавьте в неё чаты или встречи.</p>
          <Button onClick={() => setManage({ mode: "create" })}>
            <Plus size={18} />
            Создать папку
          </Button>
        </div>
      )}
      {manage && (
        <FolderManageModal {...manage} onClose={() => setManage(null)} />
      )}
    </section>
  );
}
function FolderDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const request = useFolderRequest();
  const visible = useFolderVisibility();
  const gate = useRef(false);
  const [params, setParams] = useSearchParams();
  const type = (
    ["conversation", "conference"].includes(params.get("type") || "")
      ? params.get("type")
      : "all"
  ) as FolderItemFilters["type"];
  const paramSearch = params.get("search") || "";
  const [text, setText] = useState(paramSearch);
  const [layout, setLayout] = useState<CollectionView>("list");
  useEffect(() => setText(paramSearch), [paramSearch]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim()) next.set("search", text.trim());
      else next.delete("search");
      if (next.toString() !== params.toString())
        setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, params, setParams]);
  const [manage, setManage] = useState<Management | null>(null),
    [adding, setAdding] = useState(false),
    [mapping, setMapping] = useState<FolderItem | null>(null);
  const unavailable = useCallback(() => {
    if (user) purgeFolder(client, user.id, id);
    setManage(null);
    setAdding(false);
    setMapping(null);
    navigate("/folders", { replace: true });
  }, [user, client, id, navigate]);
  const meta = useQuery({
    queryKey: ["folder", user?.id, id],
    queryFn: ({ signal }) => api.folder(id, signal),
    refetchInterval: visible ? 15000 : false,
    retry: (count, error) => !folderAccessDenied(error) && count < 2,
  });
  const entries = useInfiniteQuery({
    queryKey: [
      "folder-items",
      user?.id,
      id,
      { type, search: params.get("search") || "" },
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.folderItems(
        id,
        { type, search: params.get("search") || "" },
        pageParam,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !!meta.data && !folderAccessDenied(meta.error),
    refetchInterval: visible ? 15000 : false,
    retry: (count, error) => !folderAccessDenied(error) && count < 2,
  });
  const denied =
    folderAccessDenied(meta.error) || folderAccessDenied(entries.error);
  useEffect(() => {
    if (denied) unavailable();
  }, [denied, unavailable]);
  const remove = useMutation({
    mutationFn: (entry: FolderItem) =>
      api.setFolderItem(id, folderItemTarget(entry), false, request.signal()),
    onSuccess: async ({ item }, entry) => {
      if (!request.mounted.current || !user) return;
      const target = folderItemTarget(entry);
      updateFolder(client, user.id, item, target, false);
      updateFolderMapping(client, user.id, id, target, false);
      await invalidateFolders(client, user.id);
    },
    onError: (error) => {
      if (request.mounted.current && folderAccessDenied(error)) unavailable();
    },
    onSettled: () => {
      gate.current = false;
    },
  });
  const folder = denied ? undefined : meta.data?.item;
  const items = denied
    ? []
    : Array.from(
        new Map(
          (entries.data?.pages.flatMap((page) => page.items) || []).map(
            (entry) => [`${entry.type}:${entry.item.id}`, entry],
          ),
        ).values(),
      );
  return (
    <section
      className="folders-page pf-page pf-detail"
      aria-label="Содержимое папки"
    >
      <Link to="/folders" className="folder-back">
        <ArrowLeft size={18} aria-hidden="true" />
        Все папки
      </Link>
      <header className="folders-heading">
        <div className="pf-detail-title">
          <span
            className="pf-detail-symbol"
            data-tone={["lilac", "mint", "honey"][(folder?.position ?? 0) % 3]}
          >
            <FolderArtwork />
          </span>
          <div>
            <h2>{folder?.name || "Папка"}</h2>
            {folder && <p className="muted">{folderSummary(folder)}</p>}
          </div>
        </div>
        {folder && (
          <div className="folders-heading-actions">
            <Button onClick={() => setAdding(true)}>
              <Plus size={18} aria-hidden="true" />
              Добавить
            </Button>
            <ItemActions
              label={`Действия с папкой: ${folder.name}`}
              actions={[
                {
                  label: "Переименовать",
                  icon: <Pencil size={18} aria-hidden="true" />,
                  run: () => setManage({ mode: "rename", folder }),
                },
                {
                  label: "Удалить папку",
                  icon: <Trash2 size={18} aria-hidden="true" />,
                  run: () => setManage({ mode: "delete", folder }),
                  danger: true,
                },
              ]}
            />
          </div>
        )}
      </header>
      <ErrorNotice error={meta.error} />
      {meta.isError && !denied && (
        <Button variant="outline" onClick={() => void meta.refetch()}>
          Повторить загрузку
        </Button>
      )}
      {meta.isPending && <MessagingSkeleton />}
      {folder && (
        <div className="pf-detail-panel">
          <div className="folder-toolbar">
            <div
              className="folder-candidate-filters"
              role="group"
              aria-label="Тип элементов папки"
            >
              {(
                [
                  ["all", "Все"],
                  ["conference", "Встречи"],
                  ["conversation", "Чаты"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={type === value}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    if (value === "all") next.delete("type");
                    else next.set("type", value);
                    setParams(next);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="folder-detail-controls">
              <label className="folder-detail-search">
                <Search size={18} aria-hidden="true" />
                <input
                  aria-label="Поиск в папке"
                  value={text}
                  placeholder="Найти в папке"
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <CollectionViewToggle
                value={layout}
                onChange={setLayout}
                label="Вид содержимого папки"
              />
            </div>
          </div>
          <ErrorNotice error={entries.error || remove.error} />
          {entries.isError && !denied && (
            <Button variant="outline" onClick={() => void entries.refetch()}>
              Повторить загрузку
            </Button>
          )}
          {entries.isPending && <MessagingSkeleton />}
          <div
            className={`folder-list folder-contents folder-layout-${layout}`}
            aria-label="Элементы папки"
            aria-live="polite"
          >
            {items.map((entry) => (
              <div
                className="folder-row"
                key={`${entry.type}:${entry.item.id}`}
              >
                <Link className="folder-link" to={folderItemHref(entry)}>
                  <FolderItemLabel entry={entry} />
                  <ChevronRight
                    className="folder-row-chevron"
                    size={16}
                    aria-hidden="true"
                  />
                </Link>
                <ItemActions
                  label={`Действия с элементом: ${folderItemName(entry)}`}
                  actions={[
                    {
                      label: "Добавить в папку",
                      icon: <FolderPlus size={18} aria-hidden="true" />,
                      run: () => setMapping(entry),
                      disabled: remove.isPending,
                    },
                    {
                      label: "Удалить из папки",
                      icon: <Trash2 size={18} aria-hidden="true" />,
                      danger: true,
                      disabled: remove.isPending,
                      run: () => {
                        if (gate.current) return;
                        gate.current = true;
                        remove.mutate(entry);
                      },
                    },
                  ]}
                />
              </div>
            ))}
          </div>
          {!entries.isPending && !entries.isError && !items.length && (
            <div className="folder-empty">
              <Folder size={48} aria-hidden="true" />
              <h2>
                {params.get("search") || type !== "all"
                  ? "Ничего не найдено"
                  : "В этой папке пока ничего нет"}
              </h2>
              <p>
                {params.get("search") || type !== "all"
                  ? "Измените поиск или выберите другой тип."
                  : "Добавьте чаты или встречи с помощью кнопки выше."}
              </p>
            </div>
          )}
          {entries.hasNextPage && (
            <Button
              variant="outline"
              busy={entries.isFetchingNextPage}
              onClick={() => void entries.fetchNextPage()}
            >
              Ещё элементы
            </Button>
          )}
        </div>
      )}
      {manage && (
        <FolderManageModal
          {...manage}
          onClose={() => setManage(null)}
          onDeleted={unavailable}
        />
      )}
      {adding && folder && (
        <FolderItemPicker
          folderId={id}
          onClose={() => setAdding(false)}
          onUnavailable={unavailable}
        />
      )}
      {mapping && folder && (
        <FolderPicker
          target={folderItemTarget(mapping)}
          onClose={() => setMapping(null)}
        />
      )}
    </section>
  );
}
