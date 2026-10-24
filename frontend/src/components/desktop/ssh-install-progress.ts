export const INSTALL_PHASES = [
  {
    id: "docker",
    title: "Подготовка Docker",
    description: "Проверяем и подготавливаем среду для сервисов MeetSpace.",
  },
  {
    id: "source",
    title: "Проверка исходного кода",
    description: "Загружаем выбранную версию и проверяем её целостность.",
  },
  {
    id: "images",
    title: "Сборка компонентов",
    description:
      "Загружаем и собираем компоненты сервера. Этот этап может занять больше времени, чем остальные.",
  },
  {
    id: "configuration",
    title: "Настройка сервера",
    description: "Подготавливаем настройки, ключи и хранилище MeetSpace.",
  },
  {
    id: "dependencies",
    title: "Запуск базы данных",
    description: "Запускаем базу данных и вспомогательные сервисы.",
  },
  {
    id: "backup",
    title: "Резервная копия",
    description: "Сохраняем существующие данные перед обновлением.",
  },
  {
    id: "migrations",
    title: "Подготовка базы данных",
    description: "Применяем изменения, необходимые выбранной версии.",
  },
  {
    id: "https",
    title: "Сертификат HTTPS",
    description: "Настраиваем сертификат для защищённого подключения.",
  },
  {
    id: "services",
    title: "Запуск MeetSpace",
    description: "Запускаем сервисы встреч, сообщений и файлов.",
  },
  {
    id: "readiness",
    title: "Проверка готовности",
    description: "Проверяем, что сервер и его сервисы готовы к работе.",
  },
] as const;

export interface InstallProgressStatus {
  state: string;
  phase: string;
  completedPhases: readonly string[];
}

export type InstallProgressStepState =
  "completed" | "current" | "pending" | "stopped";

export interface InstallProgress {
  /** Share of server-confirmed steps, not elapsed time or bytes transferred. */
  percent: number | null;
  completedCount: number;
  total: number;
  /** Zero-based active/stopped step, never an inferred next step. */
  currentIndex: number | null;
  phaseTitle: string;
  detail?: string;
  steps: Array<{
    id: (typeof INSTALL_PHASES)[number]["id"];
    title: string;
    description: string;
    state: InstallProgressStepState;
  }>;
}

const componentLabels: Readonly<Record<string, string>> = {
  api: "API сервера",
  "media-worker": "обработка записей",
  worker: "фоновые задачи",
  "product-worker": "уведомления и события",
  "live-worker": "трансляции",
  frontend: "веб-интерфейс",
  minio: "хранилище файлов",
  certbot: "сертификаты HTTPS",
  coturn: "соединения для звонков",
  postgres: "база данных",
  proxy: "веб-сервер",
  rabbitmq: "очередь задач",
  redis: "кеш сервера",
};

const knownStates = new Set([
  "running",
  "cancel_requested",
  "cancelled",
  "needs_recovery",
  "failed",
  "completed",
]);
const stoppedStates = new Set(["cancelled", "needs_recovery", "failed"]);

function phaseIndex(phase: string): number {
  const group = phase.split(":", 1)[0];
  return INSTALL_PHASES.findIndex(({ id }) => id === group);
}

function componentDetail(phase: string): string | undefined {
  if (!phase.startsWith("images:")) return undefined;
  const id = phase.slice("images:".length);
  const component = Object.hasOwn(componentLabels, id)
    ? componentLabels[id]
    : undefined;
  // The signed runner reports image subtasks after they finish, not on start.
  return component ? `Подготовлен компонент: ${component}` : undefined;
}

/** Human-readable event labels; never echo unknown remote phase strings. */
export function installPhaseLabel(phase: string): string {
  if (phase === "queued") return "Ожидание запуска";
  if (phase === "resuming") return "Возобновление установки";
  const component = componentDetail(phase);
  if (component) return component;
  return INSTALL_PHASES[phaseIndex(phase)]?.title ?? "Этап уточняется";
}

/** No timer or event count contributes to progress: only confirmed checkpoints. */
export function deriveInstallProgress(
  status?: InstallProgressStatus | null,
): InstallProgress {
  const total = INSTALL_PHASES.length;
  // The IPC parser enforces this same ordered prefix. Keep the view conservative
  // if a future status is incomplete, repeated or inconsistent.
  let completedCount = 0;
  while (
    completedCount < total &&
    status?.completedPhases[completedCount] ===
      INSTALL_PHASES[completedCount].id
  ) {
    completedCount += 1;
  }
  const knownState = !!status && knownStates.has(status.state);
  const confirmedComplete =
    status?.state === "completed" &&
    completedCount === total &&
    status.completedPhases.length === total;
  const reportedIndex = status ? phaseIndex(status.phase) : -1;
  const currentIndex =
    knownState &&
    status?.state !== "completed" &&
    reportedIndex >= completedCount &&
    reportedIndex >= 0
      ? reportedIndex
      : null;

  let phaseTitle = "Проверяем состояние установки";
  let detail: string | undefined;
  if (confirmedComplete) {
    phaseTitle = "Сервер MeetSpace готов";
  } else if (knownState && status) {
    if (completedCount === total || status.state === "completed") {
      phaseTitle = "Подтверждение завершения";
      detail = "Ожидаем итоговое подтверждение от сервера.";
    } else if (currentIndex !== null) {
      phaseTitle = INSTALL_PHASES[currentIndex].title;
      detail = componentDetail(status.phase);
    } else if (reportedIndex >= 0 && reportedIndex < completedCount) {
      phaseTitle = "Переход к следующему этапу";
      detail = `Завершён этап: ${INSTALL_PHASES[reportedIndex].title}`;
    } else {
      phaseTitle = installPhaseLabel(status.phase);
    }
  }

  return {
    percent: confirmedComplete
      ? 100
      : knownState && completedCount < total && status?.state !== "completed"
        ? Math.floor((completedCount / total) * 100)
        : null,
    completedCount,
    total,
    currentIndex,
    phaseTitle,
    detail,
    steps: INSTALL_PHASES.map((step, index) => ({
      ...step,
      state:
        index < completedCount
          ? "completed"
          : index === currentIndex
            ? stoppedStates.has(status?.state ?? "")
              ? "stopped"
              : "current"
            : "pending",
    })),
  };
}
