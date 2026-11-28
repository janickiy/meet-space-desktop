import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/** Inline chat detail retains navigation and the composing thread beside the chat list. */
export function ChatInfoPage({
  title,
  backLabel = "Назад к переписке",
  className,
  children,
  onClose,
  returnFocus,
}: {
  title: string;
  backLabel?: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const headingId = useId();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus();
  }, []);

  function close() {
    onClose();
    requestAnimationFrame(() => {
      if (!back.current?.isConnected) returnFocus?.()?.focus();
    });
  }
  return (
    <section
      className={`chat-info-page ${className || ""}`}
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className="chat-info-heading">
        <button
          ref={back}
          type="button"
          className="icon-button"
          onClick={close}
          aria-label={backLabel}
          title={backLabel}
        >
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <h2 id={headingId}>{title}</h2>
      </header>
      <div className="chat-info-body">
        <div className="chat-info-stack">{children}</div>
      </div>
    </section>
  );
}
