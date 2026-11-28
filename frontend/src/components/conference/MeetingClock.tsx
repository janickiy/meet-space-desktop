import { useEffect, useState } from "react";

/** Обновляет только длительность встречи, не перерисовывая сетку видеопотоков.
 * @args startedAt — фактическое серверное начало; @return доступный таймер или отсутствие значения.
 */
export function MeetingClock({ startedAt }: { startedAt?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = Date.parse(startedAt || "");
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const parts = hours
    ? [hours, minutes, seconds % 60]
    : [minutes, seconds % 60];
  return (
    <time className="room-clock" dateTime={`PT${seconds}S`}>
      <span className="sr-only">Длительность встречи </span>
      {parts.map((part) => String(part).padStart(2, "0")).join(":")}
    </time>
  );
}
