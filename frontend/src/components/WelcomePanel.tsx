import { MessageCircle, Mic, Phone, ShieldCheck, Video } from "lucide-react";
import { PRODUCT_NAME } from "../brand";
import "./welcome-panel.css";

/** Static onboarding artwork, independent of user/device/session state. */
export function WelcomePanel({ installer = false }: { installer?: boolean }) {
  return (
    <aside className="reference-welcome on-side">
      <div className="on-logo">
        <img
          src="/branding/desktop-brand-mark.svg"
          width="32"
          height="32"
          alt=""
        />
        <span>
          {PRODUCT_NAME}
          <span className="on-logo-dot">.</span>
        </span>
      </div>
      <div className="on-side-body">
        <span className="on-kicker">
          {installer ? "ВАШ СЕРВЕР. ВАШИ ПРАВИЛА." : "БЛИЖЕ К КОМАНДЕ."}
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
              Быть на одной
              <br />
              волне.
            </>
          )}
        </h2>
        <p>
          {installer ? (
            "Подключите удалённый сервер, а мы покажем каждый шаг настройки."
          ) : (
            <>
              Встречи, сообщения и идеи —<br />в одном пространстве.
            </>
          )}
        </p>
        <div className="on-orbit-art" aria-hidden="true">
          <div className="on-orbit on-orbit-one" />
          <div className="on-orbit on-orbit-two" />
          <div className="on-orbit on-orbit-three" />
          <div className="on-orbit-line" />
          <div className="on-video-tile">
            <div className="on-person on-person-one">
              <span>АК</span>
              <i />
            </div>
            <div className="on-person on-person-two">
              <span>МИ</span>
              <i />
            </div>
            <div className="on-mini-call">
              <span>
                <Video />
              </span>
              <span>
                <Mic />
              </span>
              <span className="on-call-red">
                <Phone />
              </span>
            </div>
            <span className="on-art-live">
              <i />
              Встреча команды
            </span>
          </div>
          <div className="on-chat-bubble">
            <MessageCircle />
            <div>
              Хорошие идеи
              <br />
              <strong>начинаются здесь.</strong>
            </div>
          </div>
          <div className="on-secure-node">
            <ShieldCheck />
          </div>
          <div className="on-star-node">✦</div>
        </div>
      </div>
      <div className="on-side-footer">
        <span>
          <ShieldCheck /> На вашей инфраструктуре
        </span>
      </div>
    </aside>
  );
}
