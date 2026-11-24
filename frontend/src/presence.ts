import type { RemoteMedia } from "./media";
import type { Participant, PresenceParticipant } from "./types";

/** Собирает состав живой комнаты по подтверждённому сервером присутствию.
 * Членство и история сами по себе не подтверждают подключение. Последний снимок
 * присутствия обновляет роли и настройки медиа, включая ещё не загруженные страницы списка.
 * @args participants — сохранённые членства в порядке API; presence — последний снимок WebSocket или отсутствие связи.
 * @return Уникальные допущенные участники онлайн; исходные массивы не изменяются.
 */
export function onlineParticipants(
  participants: readonly Participant[],
  presence: readonly PresenceParticipant[] | undefined,
): Participant[] {
  if (!presence) return [];
  const snapshot = new Map(presence.map((person) => [person.id, person]));
  const merged = new Map(participants.map((person) => [person.id, person]));
  for (const person of snapshot.values()) {
    merged.set(person.id, { ...merged.get(person.id), ...person });
  }
  return [...merged.values()].filter((person) => {
    const current = snapshot.get(person.id);
    return (
      current?.online === true &&
      person.status === "joined" &&
      (!person.admissionState || person.admissionState === "admitted")
    );
  });
}

/** Select a single visible camera/avatar per member. Other streams still deliver audio. */
export function primaryParticipantStreams(
  streams: readonly RemoteMedia[],
  localId?: string,
) {
  const result = new Map<string, RemoteMedia>();
  for (const stream of streams) {
    if (stream.screen || stream.participantId === localId) continue;
    const primary = result.get(stream.participantId);
    if (
      !primary ||
      (!primary.kinds.includes("video") && stream.kinds.includes("video"))
    ) {
      result.set(stream.participantId, stream);
    }
  }
  return result;
}
