import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Primitives";

const navigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "#overview", label: "Overview", icon: "overview" },
  { href: "#models", label: "Models", icon: "models" },
  { href: "#routing", label: "Routing", icon: "routing" },
  { href: "#benchmarks", label: "Benchmarks", icon: "benchmark" },
  { href: "#usage", label: "Usage", icon: "usage" },
  { href: "#opencode", label: "OpenCode", icon: "code" },
];

export function AppShell({
  children,
  footer,
  headerActions,
}: {
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
}) {
  const [activeHref, setActiveHref] = useState(() => window.location.hash || "#overview");

  useEffect(() => {
    const updateActiveLink = () => setActiveHref(window.location.hash || "#overview");
    window.addEventListener("hashchange", updateActiveLink);
    return () => window.removeEventListener("hashchange", updateActiveLink);
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to model control</a>
      <aside className="sidebar" aria-label="Control panel navigation">
        <div className="brand-mark" aria-hidden="true">OC</div>
        <nav className="sidebar__nav">
          {navigation.map((item) => (
            <a
              aria-current={activeHref === item.href ? "location" : undefined}
              className={activeHref === item.href ? "nav-link nav-link--active" : "nav-link"}
              href={item.href}
              key={item.href}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar__secondary">
          <a className="nav-link" href="#routing-settings"><Icon name="settings" size={19} /><span>Settings</span></a>
          <a className="nav-link" href="#methodology"><Icon name="help" size={19} /><span>Methodology</span></a>
        </div>
        <div className="sidebar__footer">{footer}</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <h1>OpenCode Model Control</h1>
            <p>Local control plane for evidence-led OpenCode model routing.</p>
          </div>
          <div className="topbar__actions">{headerActions}</div>
        </header>
        <nav className="mobile-nav" aria-label="Section navigation">
          {navigation.map((item) => <a aria-current={activeHref === item.href ? "location" : undefined} href={item.href} key={item.href}>{item.label}</a>)}
        </nav>
        <main className="content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
