import {
  MessageSquare,
  MessageCircle,
  Mic,
  MonitorUp,
  PhoneOff,
  Phone,
  ShieldCheck,
  Video,
} from "lucide-react";
import { BRAND_ASSET_VERSION, PRODUCT_NAME } from "../brand";
import "./welcome-panel.css";

/** Decorative artwork from the supplied desktop reference, separate from live call state. */
export function WelcomePanel({ installer = false }: { installer?: boolean }) {
  return (
    <aside
      className={`reference-welcome${installer ? " reference-welcome-installer" : ""}`}
    >
      <div className="reference-welcome-brand">
        <img
          src={`/branding/meetspace-symbol-color.svg?v=${BRAND_ASSET_VERSION}`}
          alt=""
        />
        <span>{PRODUCT_NAME}</span>
        {installer && (
          <small className="desktop-ssh-brand-caption">
            ДЛЯ WINDOWS И LINUX
          </small>
        )}
      </div>
      <div className="reference-welcome-copy">
        <span>
          {installer
            ? "ВАШ СЕРВЕР. ВАШИ ПРАВИЛА."
            : "МЕСТО, ГДЕ КОМАНДА ВМЕСТЕ"}
        </span>
        <h2>
          {installer ? (
            <>
              Своё пространство.
              <br />
              Полный контроль.
            </>
          ) : (
            <>
              Большие идеи
              <br />
              начинаются
              <br />с разговора.
            </>
          )}
        </h2>
        <p>
          {installer ? (
            <>
              Подключите удалённый сервер,
              <br />а мы покажем каждый шаг настройки.
            </>
          ) : (
            <>
              Встречи, сообщения и решения.
              <br />В одном пространстве вашей команды.
            </>
          )}
        </p>
      </div>
      {installer ? (
        <div className="desktop-ssh-art" aria-hidden="true">
          <div className="desktop-ssh-art-orbit">
            <div />
            <div />
          </div>
          <div className="desktop-ssh-art-call">
            <span className="desktop-ssh-art-live">Встреча команды</span>
            <div className="desktop-ssh-art-people">
              <span>АК</span>
              <span>МП</span>
            </div>
            <div className="desktop-ssh-art-controls">
              <span>
                <Video />
              </span>
              <span>
                <Mic />
              </span>
              <span>
                <Phone />
              </span>
            </div>
          </div>
          <div className="desktop-ssh-art-message">
            <MessageCircle />
            <div>
              Хорошие идеи.
              <br />
              <strong>Начинаются здесь.</strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="reference-welcome-art" aria-hidden="true">
          <div className="reference-welcome-call">
            <div className="reference-welcome-live">
              <i />
              Команда на связи
            </div>
            <div className="reference-welcome-people">
              <div>
                <span>АС</span>
                <small>Вы</small>
              </div>
              <div>
                <span>АК</span>
                <small>Анна</small>
              </div>
              <div>
                <span>МП</span>
                <small>Максим</small>
              </div>
            </div>
            <div className="reference-welcome-controls">
              <span>
                <Mic />
              </span>
              <span>
                <Video />
              </span>
              <span>
                <MonitorUp />
              </span>
              <span>
                <PhoneOff />
              </span>
            </div>
          </div>
          <div className="reference-welcome-message">
            <MessageSquare />
            <div>
              <strong>Отличная идея.</strong>
              <p>Давайте сделаем вместе!</p>
            </div>
          </div>
        </div>
      )}
      <div className="reference-welcome-footer">
        <ShieldCheck size={15} />
        {installer
          ? "На вашей инфраструктуре"
          : "Ваш сервер. Ваши данные. Ваша команда."}
      </div>
    </aside>
  );
}
