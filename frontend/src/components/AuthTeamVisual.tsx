import { MessageSquare, Mic, Phone, UserRound, Video } from "lucide-react";
import "./auth-team-visual.css";

/** Декоративная иллюстрация общения без имён, сообщений и состояния реального звонка. */
export function AuthTeamVisual() {
  return (
    <div className="auth-team-illustration" aria-hidden="true">
      <div className="auth-illustration-call">
        <Video size={20} />
        <div className="auth-illustration-people">
          <span>
            <UserRound />
          </span>
          <span>
            <UserRound />
          </span>
          <span>
            <UserRound />
          </span>
        </div>
        <div className="auth-illustration-controls">
          <span>
            <Mic />
          </span>
          <span>
            <Video />
          </span>
          <span>
            <Phone />
          </span>
        </div>
      </div>
      <div className="auth-illustration-message">
        <MessageSquare size={24} />
        <span>
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
