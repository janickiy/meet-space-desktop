import { useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { PRODUCT_NAME } from "../brand";
import { appBuild } from "../buildInfo";
import { IconButton, Modal } from "./ui";

export function EntryFrame({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState(false);
  return (
    <div className="entry-frame">
      <header className="entry-title">
        <span className="desktop-brand">
          <img
            src="/branding/desktop-brand-mark.svg"
            width="26"
            height="29"
            alt=""
          />
          <strong>{PRODUCT_NAME}</strong>
        </span>
        <IconButton label="Помощь со входом" onClick={() => setHelp(true)}>
          <CircleHelp />
        </IconButton>
      </header>
      <div className="entry-content">{children}</div>
      <footer className="desktop-status">
        <span>{PRODUCT_NAME} Desktop</span>
        <span>{appBuild.version}</span>
      </footer>
      {help && (
        <Modal title="Помощь со входом" onClose={() => setHelp(false)}>
          <p>
            Введите HTTPS-адрес сервера вашей команды. Если адрес неизвестен,
            запросите его у администратора.
          </p>
          <p>
            После подключения используйте учётные данные этого сервера. Для
            корпоративного входа нужны рабочий email и пароль организации.
          </p>
        </Modal>
      )}
    </div>
  );
}
