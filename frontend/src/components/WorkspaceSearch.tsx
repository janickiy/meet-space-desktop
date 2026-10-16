import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  CalendarDays,
  Folder,
  MessageCircle,
  Search,
  Video,
  CirclePlay,
} from "lucide-react";
import { Modal } from "./ui";

const destinations = [
  {
    title: "Встречи",
    detail: "Текущие и запланированные встречи",
    to: "/conferences",
    Icon: Video,
  },
  {
    title: "Чаты",
    detail: "Личные сообщения и группы",
    to: "/personal",
    Icon: MessageCircle,
  },
  {
    title: "Календарь",
    detail: "Расписание встреч",
    to: "/calendar",
    Icon: CalendarDays,
  },
  {
    title: "Записи",
    detail: "Видео, расшифровки и итоги",
    to: "/recordings",
    Icon: CirclePlay,
  },
  {
    title: "Папки",
    detail: "Ваши чаты и встречи по темам",
    to: "/folders",
    Icon: Folder,
  },
];

/** Keyboard navigation and meeting search reuse the application's real routes. */
export function WorkspaceSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        setQuery("");
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const value = query.trim();
  return (
    <>
      <button
        className="workspace-search-trigger"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        aria-label="Поиск в пространстве"
      >
        <Search size={16} aria-hidden="true" />
        <span>Поиск в пространстве</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && (
        <Modal
          title="Поиск в пространстве"
          onClose={() => setOpen(false)}
          className="workspace-search-dialog"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (value)
                document.getElementById("workspace-meeting-search")?.click();
            }}
          >
            <label className="workspace-search-input">
              <Search size={19} aria-hidden="true" />
              <input
                data-autofocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название встречи или раздела"
                aria-label="Название встречи или раздела"
                maxLength={200}
              />
            </label>
          </form>
          <p className="workspace-search-caption">Быстрый переход</p>
          <nav
            className="workspace-search-results"
            aria-label="Результаты поиска по разделам"
          >
            {destinations
              .filter((item) =>
                `${item.title} ${item.detail}`
                  .toLocaleLowerCase("ru")
                  .includes(value.toLocaleLowerCase("ru")),
              )
              .map(({ title, detail, to, Icon }) => (
                <Link key={to} to={to} onClick={() => setOpen(false)}>
                  <Icon size={20} aria-hidden="true" />
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              ))}
            {value && (
              <Link
                id="workspace-meeting-search"
                to={`/conferences?search=${encodeURIComponent(value)}`}
                onClick={() => setOpen(false)}
              >
                <Search size={20} aria-hidden="true" />
                <span>
                  <strong>Найти встречи «{value}»</strong>
                  <small>Поиск по загруженному списку встреч</small>
                </span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            )}
          </nav>
        </Modal>
      )}
    </>
  );
}
