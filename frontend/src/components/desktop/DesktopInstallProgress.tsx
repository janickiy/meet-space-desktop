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
  imageMode = "source",
}: {
  status: SshInstallerState["status"];
  stale: boolean;
  checkedAt: number | null;
  imageMode?: "images" | "source";
}) {
  const progress = deriveInstallProgress(status, imageMode);
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
  const summary = `${progress.percent}%. Завершено этапов: ${progress.completedCount} из ${progress.total}. ${progress.phaseTitle}`;
  const ProgressContainer = completed ? "details" : "div";
  const PhaseContainer = completed ? "div" : "details";

  return (
    <ProgressContainer
      className={
        completed ? "desktop-ssh-completed-phases" : "desktop-ssh-live-progress"
      }
    >
      {completed && (
        <summary>
          <Check size={16} aria-hidden="true" />
          Все {progress.total} этапов завершены <span>100%</span>
        </summary>
      )}
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
          {progress.percent !== null && (
            <div className="desktop-ssh-progress-percent" aria-hidden="true">
              <strong>{progress.percent}%</strong>
              <span>по этапам</span>
            </div>
          )}
        </div>
        {progress.percent !== null && (
          <>
            <progress
              className="desktop-ssh-progress-bar"
              role="progressbar"
              max={100}
              value={progress.percent}
              aria-label="Прогресс установки по этапам"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-valuetext={stale ? `Последние данные: ${summary}` : summary}
            />
            <div className="desktop-ssh-progress-meta">
              <strong>
                Завершено этапов: {progress.completedCount} из {progress.total}
              </strong>
              {checkedAt && (
                <span>
                  Обновлено {new Date(checkedAt).toLocaleTimeString("ru-RU")}
                </span>
              )}
            </div>
          </>
        )}
        {status ? (
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
                {completed ? "Все этапы завершены" : progress.phaseTitle}
              </strong>
            )}
          </div>
        ) : (
          <p className="desktop-ssh-progress-unavailable">
            Проверьте состояние, чтобы увидеть текущий этап и процент установки.
            Само открытие карточки не запускает и не возобновляет установку.
          </p>
        )}
        {stale && status && (
          <p className="desktop-ssh-progress-freshness" role="status">
            Показаны последние полученные данные. Проверьте состояние установки.
          </p>
        )}
        {!completed && progress.percent !== null && (
          <p className="desktop-ssh-progress-explanation">
            Процент — по завершённым этапам. Время каждого этапа различается.
          </p>
        )}
      </section>
      {status && (
        <PhaseContainer
          className={completed ? undefined : "desktop-ssh-phase-details"}
        >
          {!completed && (
            <summary>
              Все этапы установки
              <span>
                {progress.completedCount} / {progress.total}
              </span>
            </summary>
          )}
          <ol
            className="desktop-ssh-phases"
            aria-label="Ход установки по этапам"
          >
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
        </PhaseContainer>
      )}
    </ProgressContainer>
  );
}
