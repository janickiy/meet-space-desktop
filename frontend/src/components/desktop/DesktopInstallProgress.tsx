import { Check, CirclePause, LoaderCircle } from "lucide-react";
import type { SshInstallerState } from "../../platform/desktop-contracts";
import { deriveInstallProgress } from "./ssh-install-progress";

const titles = {
  running: "Установка выполняется",
  cancel_requested: "Останавливаем после текущего шага",
  cancelled: "Установка остановлена",
  needs_recovery: "Установка ждёт продолжения",
  failed: "Не удалось завершить установку",
  completed: "Сервер MeetSpace готов",
};

export function DesktopInstallProgress({
  status,
  stale,
  checkedAt,
}: {
  status: SshInstallerState["status"];
  stale: boolean;
  checkedAt: number | null;
}) {
  const progress = deriveInstallProgress(status);
  const mode = stale ? "stale" : (status?.state ?? "unknown");
  const title = stale
    ? "Нет актуального состояния"
    : status
      ? titles[status.state]
      : "Состояние установки неизвестно";
  const current =
    progress.currentIndex === null
      ? null
      : progress.steps[progress.currentIndex];
  const active = !stale && status?.state === "running";
  const completed = progress.percent === 100;
  const summary =
    progress.percent === null
      ? "Ожидаем подтверждённое состояние сервера"
      : `${progress.percent}%. Завершено этапов: ${progress.completedCount} из ${progress.total}. ${progress.phaseTitle}`;

  return (
    <>
      <section
        className="desktop-ssh-progress-summary"
        data-mode={mode}
        aria-labelledby="desktop-ssh-progress-title"
      >
        <div className="desktop-ssh-progress-top">
          <div>
            <span className="desktop-ssh-progress-kicker">
              Установка сервера
            </span>
            <h2
              id="desktop-ssh-progress-title"
              tabIndex={-1}
              role="status"
              aria-live="polite"
            >
              {title}
            </h2>
          </div>
          <div className="desktop-ssh-progress-percent" aria-hidden="true">
            <strong>
              {progress.percent === null ? "—" : `${progress.percent}%`}
            </strong>
            <span>
              {progress.percent === null ? "нет оценки" : "по этапам"}
            </span>
          </div>
        </div>
        <progress
          className="desktop-ssh-progress-bar"
          role="progressbar"
          max={100}
          value={progress.percent ?? undefined}
          aria-label="Прогресс установки по этапам"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent ?? undefined}
          aria-valuetext={stale ? `Последние данные: ${summary}` : summary}
        />
        <div className="desktop-ssh-progress-meta">
          <strong>
            {status
              ? `Завершено этапов: ${progress.completedCount} из ${progress.total}`
              : "Ожидаем данные сервера"}
          </strong>
          {checkedAt && (
            <span>
              Обновлено {new Date(checkedAt).toLocaleTimeString("ru-RU")}
            </span>
          )}
        </div>
        <div
          className="desktop-ssh-current-phase"
          aria-live="polite"
          aria-atomic="true"
        >
          {current ? (
            <>
              <span className="desktop-ssh-current-label">
                {stale ? "Последний известный этап" : "Этап"}{" "}
                {progress.currentIndex! + 1} из {progress.total}
              </span>
              <strong>{progress.phaseTitle}</strong>
              {!stale && active && <p>{current.description}</p>}
              {progress.detail && (
                <p className="desktop-ssh-component-detail">
                  {progress.detail}
                </p>
              )}
            </>
          ) : (
            <strong>
              {completed
                ? "Все этапы завершены"
                : status
                  ? progress.phaseTitle
                  : "Проверьте состояние, чтобы увидеть этап и процент установки."}
            </strong>
          )}
        </div>
        {stale && (
          <p className="desktop-ssh-progress-freshness" role="status">
            Показаны последние полученные данные. Проверьте состояние установки.
          </p>
        )}
        {!completed && (
          <p className="desktop-ssh-progress-explanation">
            Процент рассчитан по завершённым этапам. Их длительность
            различается; во время сборки значение может долго не меняться.
          </p>
        )}
      </section>
      {status && (
        <ol className="desktop-ssh-phases" aria-label="Ход установки по этапам">
          {progress.steps.map((step, index) => {
            const isCurrent =
              step.state === "current" || step.state === "stopped";
            const paused = isCurrent && (!active || stale);
            const label =
              step.state === "completed"
                ? "Готово"
                : isCurrent
                  ? stale
                    ? "Нужна проверка"
                    : step.state === "stopped"
                      ? "Остановлено"
                      : status.state === "cancel_requested"
                        ? "Остановка"
                        : "Выполняется"
                  : "Ожидает";
            return (
              <li
                key={step.id}
                aria-current={isCurrent ? "step" : undefined}
                className={
                  step.state === "completed"
                    ? "is-complete"
                    : isCurrent
                      ? `is-current${paused ? " is-paused" : ""}`
                      : ""
                }
              >
                <span aria-hidden="true">
                  {step.state === "completed" ? (
                    <Check size={16} />
                  ) : isCurrent ? (
                    paused ? (
                      <CirclePause size={17} />
                    ) : (
                      <LoaderCircle size={17} className="spin" />
                    )
                  ) : (
                    index + 1
                  )}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{label}</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
