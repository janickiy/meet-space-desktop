import type {
  Conference,
  ConferenceHistory,
  ConferenceRecording,
  CursorItems,
} from "./types";

export interface RecordingLibraryEntry {
  conference: Conference;
  record: ConferenceRecording;
  history?: ConferenceHistory;
}
interface RecordingTask {
  conference: Conference;
  offset: number;
}
export interface RecordingLibraryCursor {
  conferenceCursor?: string;
  conferencesDone?: boolean;
  pending: RecordingTask[];
}
interface LibrarySource {
  conferences: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<CursorItems<Conference>>;
  recordings: (
    id: string,
    offset: number,
    signal: AbortSignal,
  ) => Promise<{ items: ConferenceRecording[] }>;
  history: (
    id: string,
    signal: AbortSignal,
  ) => Promise<{ item: ConferenceHistory }>;
}

/** Assemble a catalogue from the existing per-meeting API, in bounded, cancellable pages.
 * Six meetings per page, at most three concurrent requests; full recording pages retain
 * their offset so neither a long meeting nor the next conference cursor loses records.
 */
export async function loadRecordingLibraryPage(
  source: LibrarySource,
  cursor: RecordingLibraryCursor,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let { conferenceCursor, conferencesDone = false } = cursor;
  const pending = [...cursor.pending];
  if (!pending.length && !conferencesDone) {
    const page = await source.conferences(conferenceCursor, signal);
    pending.push(
      ...[...new Map(page.items.map((item) => [item.id, item])).values()].map(
        (conference) => ({ conference, offset: 0 }),
      ),
    );
    conferencesDone = !page.nextCursor || page.nextCursor === conferenceCursor;
    conferenceCursor = page.nextCursor || undefined;
  }
  const tasks = pending.splice(0, 6);
  const entries: RecordingLibraryEntry[] = [];
  const failed: string[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, tasks.length) }, async () => {
      while (index < tasks.length) {
        signal.throwIfAborted();
        const task = tasks[index++];
        try {
          const page = await source.recordings(
            task.conference.id,
            task.offset,
            signal,
          );
          signal.throwIfAborted();
          let history: ConferenceHistory | undefined;
          if (page.items.some((record) => record.status === "ready")) {
            try {
              const candidate = (
                await source.history(task.conference.id, signal)
              ).item;
              if (candidate.conference.id === task.conference.id)
                history = candidate;
            } catch {
              signal.throwIfAborted();
            }
          }
          entries.push(
            ...page.items
              .filter((record) => record.conferenceId === task.conference.id)
              .map((record) => ({
                conference: task.conference,
                record,
                history,
              })),
          );
          if (page.items.length === 20)
            pending.push({ ...task, offset: task.offset + 20 });
        } catch {
          signal.throwIfAborted();
          failed.push(task.conference.id);
        }
      }
    }),
  );
  return {
    entries,
    failed,
    next:
      pending.length || !conferencesDone
        ? ({
            conferenceCursor,
            conferencesDone,
            pending,
          } satisfies RecordingLibraryCursor)
        : undefined,
  };
}
