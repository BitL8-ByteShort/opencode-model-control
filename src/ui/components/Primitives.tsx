import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconName =
  | "overview"
  | "models"
  | "routing"
  | "benchmark"
  | "usage"
  | "code"
  | "settings"
  | "help"
  | "refresh"
  | "download"
  | "copy"
  | "check"
  | "lock"
  | "image"
  | "arrow";

const paths: Record<IconName, ReactNode> = {
  overview: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.2V21h13V9.2M9 21v-6h6v6"/></>,
  models: <><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4.3 6.7 7.7 4.5 7.7-4.5M12 11.2V20"/></>,
  routing: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 5h2a4 4 0 0 1 4 4v5a4 4 0 0 0 4 4M14 10a4 4 0 0 1 4-3"/></>,
  benchmark: <><path d="M4 21V10h4v11M10 21V3h4v18M16 21v-7h4v7M2 21h20"/></>,
  usage: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/><path d="M2 21h20"/></>,
  code: <><path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M14 4l-4 16"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01"/></>,
  refresh: <><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 9A7 7 0 0 1 18.7 7L20 11M4 13l1.3 4A7 7 0 0 0 17.9 15"/></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 18v3h16v-3"/></>,
  copy: <><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 20"/></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        {paths[name]}
      </g>
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  tone?: "default" | "primary" | "quiet" | "danger";
}

export function Button({ children, className = "", icon, tone = "default", ...props }: ButtonProps) {
  return (
    <button className={`button button--${tone} ${className}`.trim()} {...props}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function StatusDot({ tone = "positive" }: { tone?: "positive" | "warning" | "negative" | "neutral" | "info" }) {
  return <span aria-hidden="true" className={`status-dot status-dot--${tone}`} />;
}

export function Panel({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return <section className={`panel ${className}`.trim()} id={id}>{children}</section>;
}
