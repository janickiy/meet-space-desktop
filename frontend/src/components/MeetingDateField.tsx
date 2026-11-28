import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import "./meeting-date-field.css";

const weekdays = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const monthName = new Intl.DateTimeFormat("ru", {
  month: "long",
  timeZone: "UTC",
});
const fullDate = new Intl.DateTimeFormat("ru", {
  dateStyle: "full",
  timeZone: "UTC",
});

function isoDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function readDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && isoDate(date) === value ? date : null;
}

function displayDate(value: string) {
  return value.split("-").reverse().join(".");
}

function parseEntry(value: string) {
  const text = value.trim().replace(/\s/g, "");
  const parts =
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text) ||
    /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  if (!parts) return readDate(text);
  const [, day, month, year] = parts;
  return readDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

function shiftDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function shiftMonth(date: Date, months: number) {
  const next = shiftDays(date, 1 - date.getUTCDate());
  next.setUTCMonth(next.getUTCMonth() + months);
  const end = new Date(next);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return next;
}

function firstDayOfMonth(date: Date) {
  return shiftDays(date, 1 - date.getUTCDate());
}

function weekday(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

function today() {
  const local = new Date();
  return new Date(
    Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 12),
  );
}

export function MeetingDateField({
  id,
  label,
  accessibleName,
  value,
  onChange,
  min = "0001-01-01",
  max = "9999-12-31",
  disabled,
  required,
}: {
  id?: string;
  label: string;
  accessibleName?: string;
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const calendarId = `${inputId}-calendar`;
  const name = accessibleName || label;
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);
  const [draft, setDraft] = useState<{ value: string; text: string }>();
  const [activeDate, setActiveDate] = useState<Date | null>(null);
  const [monthPicker, setMonthPicker] = useState(false);
  const open = Boolean(activeDate) && !disabled;
  const text = draft?.value === value ? draft.text : displayDate(value);
  const todayDate = today();
  const currentDate = isoDate(todayDate);
  const earliest = readDate(min)!;
  const latest = readDate(max)!;
  const parsed = parseEntry(text);
  const validationMessage =
    text && !parsed
      ? "Введите дату в формате дд.мм.гггг."
      : parsed && (parsed < earliest || parsed > latest)
        ? "Выберите дату в пределах указанного периода."
        : "";

  function inRange(date: Date) {
    return date >= earliest && date <= latest;
  }

  function betweenBounds(date: Date) {
    if (date < earliest) return earliest;
    if (date > latest) return latest;
    return date;
  }

  function openCalendar() {
    focusDay.current = true;
    setMonthPicker(false);
    setActiveDate(betweenBounds(readDate(value) || todayDate));
  }

  function closeCalendar(restoreFocus: boolean) {
    setActiveDate(null);
    setMonthPicker(false);
    if (restoreFocus) input.current?.focus();
  }

  function updateText(next: string) {
    const parsed = parseEntry(next);
    if (!next || (parsed && inRange(parsed))) {
      setDraft(undefined);
      const nextValue = parsed ? isoDate(parsed) : "";
      if (nextValue !== value) onChange(nextValue);
    } else {
      setDraft({ value, text: next });
    }
  }

  function chooseDate(date: string) {
    setDraft(undefined);
    onChange(date);
    closeCalendar(true);
  }

  useLayoutEffect(() => {
    input.current?.setCustomValidity(validationMessage);
  }, [validationMessage]);

  useLayoutEffect(() => {
    const popup = panel.current;
    const anchor = field.current?.querySelector(".meeting-date-control");
    if (!open || !popup || !anchor) return;
    function position() {
      const { left, top, bottom } = anchor!.getBoundingClientRect();
      const { width, height } = popup!.getBoundingClientRect();
      popup!.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
      const below = bottom + 2;
      const above = top - height - 2;
      const y =
        below + height + 8 <= innerHeight || above < 8
          ? Math.min(below, innerHeight - height - 8)
          : above;
      popup!.style.top = `${Math.max(8, y)}px`;
    }
    function outside(event: PointerEvent) {
      if (!field.current?.contains(event.target as Node)) setActiveDate(null);
    }
    popup.showPopover();
    position();
    const resize = new ResizeObserver(position);
    resize.observe(popup);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      if (popup.matches(":popover-open")) popup.hidePopover();
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open]);

  const cursor = activeDate ? isoDate(activeDate) : "";
  useLayoutEffect(() => {
    if (!open || !focusDay.current || monthPicker) return;
    focusDay.current = false;
    panel.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)
      ?.focus({ preventScroll: true });
  }, [open, cursor, monthPicker]);

  function navigate(event: KeyboardEvent<HTMLTableElement>) {
    if (!activeDate) return;
    const date = activeDate;
    const weekdaysLeft = weekday(date);
    const days = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekdaysLeft,
      End: 6 - weekdaysLeft,
    };
    let next: Date;
    if (event.key === "PageUp" || event.key === "PageDown") {
      const direction = event.key === "PageUp" ? -1 : 1;
      next = shiftMonth(date, direction * (event.shiftKey ? 12 : 1));
    } else if (Object.hasOwn(days, event.key)) {
      next = shiftDays(date, days[event.key as keyof typeof days]);
    } else return;
    event.preventDefault();
    if (!inRange(next)) return;
    focusDay.current = true;
    setActiveDate(next);
  }

  const year = activeDate?.getUTCFullYear() ?? 0;
  const month = activeDate?.getUTCMonth() ?? 0;
  const first = firstDayOfMonth(activeDate || todayDate);
  const start = shiftDays(first, -weekday(first));
  const monthLabel = activeDate
    ? `${monthName.format(activeDate)} ${year} г.`
    : "";

  function changeMonth(next: Date) {
    setActiveDate(betweenBounds(next));
  }

  function monthInRange(date: Date) {
    const first = firstDayOfMonth(date);
    const last = shiftDays(shiftMonth(first, 1), -1);
    return first <= latest && last >= earliest;
  }

  function changeYear(next: HTMLInputElement) {
    if (!activeDate) return;
    const number = next.valueAsNumber;
    if (Number.isInteger(number) && number >= 1 && number <= 9999) {
      changeMonth(shiftMonth(activeDate, (number - year) * 12));
    } else next.value = String(year);
  }

  return (
    <div
      className="field meeting-date-field"
      ref={field}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          closeCalendar(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          closeCalendar(true);
        }
      }}
    >
      <label htmlFor={inputId}>{label}</label>
      <div className="meeting-date-control">
        <input
          id={inputId}
          ref={input}
          className="meeting-date-input"
          type="text"
          aria-label={accessibleName}
          aria-invalid={Boolean(validationMessage) || undefined}
          lang="ru"
          inputMode="numeric"
          autoComplete="off"
          placeholder="дд . мм . гггг"
          value={text}
          disabled={disabled}
          required={required}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={(event) => {
            if (event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              openCalendar();
            }
          }}
        />
        <button
          type="button"
          className="meeting-date-trigger"
          aria-label={`Открыть календарь: ${name}`}
          aria-expanded={open}
          aria-controls={open ? calendarId : undefined}
          disabled={disabled}
          onClick={() => (open ? closeCalendar(true) : openCalendar())}
        >
          <CalendarDays size={15} aria-hidden="true" />
        </button>
      </div>
      {open && activeDate && (
        <div
          id={calendarId}
          ref={panel}
          popover="manual"
          className="meeting-date-popup"
          role="group"
          aria-label={`Календарь: ${name}`}
        >
          <div className="meeting-date-calendar-header">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              disabled={!monthInRange(shiftMonth(activeDate, -1))}
              onClick={() => changeMonth(shiftMonth(activeDate, -1))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="meeting-date-period"
              aria-expanded={monthPicker}
              onClick={() => {
                focusDay.current = monthPicker;
                setMonthPicker(!monthPicker);
              }}
            >
              {monthLabel}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Следующий месяц"
              disabled={!monthInRange(shiftMonth(activeDate, 1))}
              onClick={() => changeMonth(shiftMonth(activeDate, 1))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          {monthPicker ? (
            <div className="meeting-date-month-picker">
              <select
                aria-label="Месяц"
                value={month}
                onChange={(event) =>
                  changeMonth(
                    shiftMonth(activeDate, Number(event.target.value) - month),
                  )
                }
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index} value={index}>
                    {monthName.format(new Date(Date.UTC(2026, index, 1)))}
                  </option>
                ))}
              </select>
              <input
                key={year}
                type="number"
                aria-label="Год"
                min={1}
                max={9999}
                defaultValue={year}
                onBlur={(event) => changeYear(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  changeYear(event.currentTarget);
                  focusDay.current = true;
                  setMonthPicker(false);
                }}
              />
            </div>
          ) : (
            <table
              role="grid"
              aria-label={monthLabel}
              onKeyDown={navigate}
              className="meeting-date-calendar-grid"
            >
              <thead>
                <tr>
                  {weekdays.map((day) => (
                    <th scope="col" key={day}>
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, row) => (
                  <tr key={row}>
                    {Array.from({ length: 7 }, (_, col) => {
                      const day = shiftDays(start, row * 7 + col);
                      const iso = isoDate(day);
                      return (
                        <td key={iso} aria-selected={iso === value}>
                          <button
                            type="button"
                            data-day={iso}
                            data-outside={
                              day.getUTCMonth() !== month || undefined
                            }
                            tabIndex={iso === cursor ? 0 : -1}
                            aria-label={fullDate.format(day)}
                            aria-current={
                              iso === currentDate ? "date" : undefined
                            }
                            disabled={!inRange(day)}
                            onClick={() => chooseDate(iso)}
                          >
                            {day.getUTCDate()}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            className="meeting-date-clear"
            onClick={() => chooseDate("")}
          >
            Очистить
          </button>
        </div>
      )}
    </div>
  );
}
