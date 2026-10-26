import { MeetingQrCode } from "./ConferenceInvitations";
import { CopyLink } from "./ui";
import "./meeting-modals.css";

/** The copied link and QR code always share the same invitation URL. */
export function MeetingInvitationCard({ link }: { link: string }) {
  return (
    <section
      className="meeting-invitation-card"
      aria-label="Приглашение на встречу"
    >
      <div className="meeting-invitation-link">
        <h4>Ссылка-приглашение</h4>
        <p>Поделитесь ссылкой или QR-кодом встречи.</p>
        <CopyLink value={link} />
        <p className="meeting-invitation-hint">
          По ссылке можно присоединиться без аккаунта.
        </p>
      </div>
      <MeetingQrCode link={link} />
    </section>
  );
}
