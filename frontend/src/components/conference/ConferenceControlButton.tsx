import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  busy?: boolean;
  danger?: boolean;
};

/** A conference control keeps its icon tile separate from its visible label. */
export function ConferenceControlButton({
  icon,
  label,
  busy,
  danger,
  className = "",
  disabled,
  ...props
}: Props) {
  return (
    <button
      type="button"
      {...props}
      className={`conference-room-control ${danger ? "conference-room-control-danger" : ""} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="conference-room-control-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="conference-room-control-label">{label}</span>
    </button>
  );
}
