import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { isDesktopBuild, platform } from "../platform";
import { externalLinkClick } from "../platform/externalLink";

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [href],
  );
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const request = externalLinkClick(
      event,
      isDesktopBuild,
      href,
      platform.openExternal,
    );
    if (!request) return;
    const current = ++revision.current;
    setFailed(false);
    void request.catch(() => {
      if (current === revision.current) setFailed(true);
    });
  };
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={open}
        onAuxClick={(event) => {
          if (event.button === 1) open(event);
        }}
      >
        {children}
      </a>
      {failed && (
        <span role="alert">
          {" "}
          Не удалось открыть ссылку. Переход по этому адресу может быть
          недоступен в приложении.
        </span>
      )}
    </>
  );
}
