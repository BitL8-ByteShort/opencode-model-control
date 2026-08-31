import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Primitives";

interface NavigationItem {
  href: string;
  label: string;
  icon: IconName;
}

const navigation: NavigationItem[] = [
  { href: "#overview", label: "Overview", icon: "overview" },
  { href: "#models", label: "Models", icon: "models" },
  { href: "#routing", label: "Routing", icon: "routing" },
  { href: "#benchmarks", label: "Benchmarks", icon: "benchmark" },
  { href: "#usage", label: "Usage", icon: "usage" },
  { href: "#opencode", label: "OpenCode", icon: "code" },
];

const secondaryNavigation: NavigationItem[] = [
  { href: "#routing-settings", label: "Settings", icon: "settings" },
  { href: "#methodology", label: "Methodology", icon: "help" },
];

const sidebarPreferenceKey = "omc.sidebar.collapsed";

function storedSidebarPreference() {
  try {
    const stored = window.localStorage.getItem(sidebarPreferenceKey);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // The shell remains usable when storage is blocked by the browser.
  }
  return window.matchMedia("(max-width: 1199px)").matches;
}

function NavigationLink({
  activeHref,
  collapsed = false,
  item,
  onNavigate,
}: {
  activeHref: string;
  collapsed?: boolean;
  item: NavigationItem;
  onNavigate?: () => void;
}) {
  const active = activeHref === item.href;
  return (
    <a
      aria-current={active ? "location" : undefined}
      className={active ? "nav-link nav-link--active" : "nav-link"}
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
    >
      <Icon name={item.icon} size={19} />
      <span className="nav-link__label">{item.label}</span>
    </a>
  );
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarPreference);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const updateActiveLink = () => setActiveHref(window.location.hash || "#overview");
    window.addEventListener("hashchange", updateActiveLink);
    return () => window.removeEventListener("hashchange", updateActiveLink);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarPreferenceKey, String(sidebarCollapsed));
    } catch {
      // A blocked preference write must not prevent navigation from working.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const dialog = drawerRef.current;
    if (!dialog) return undefined;

    if (!drawerOpen) {
      if (dialog.open) dialog.close();
      return undefined;
    }

    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => drawerCloseButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      window.requestAnimationFrame(() => {
        if (menuButtonRef.current?.offsetParent !== null) menuButtonRef.current?.focus();
      });
    };
  }, [drawerOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 821px)");
    const closeOnDesktop = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setDrawerOpen(false);
    };
    closeOnDesktop(desktop);
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className={sidebarCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}>
      <a className="skip-link" href="#main-content">Skip to model control</a>
      <aside className="sidebar" id="desktop-sidebar">
        <div className="sidebar__brand-row">
          <div className="brand-mark" aria-hidden="true">OC</div>
          <button
            aria-controls="desktop-sidebar-navigation"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            type="button"
          >
            <Icon name={sidebarCollapsed ? "panel-open" : "panel-close"} size={18} />
          </button>
        </div>
        <nav aria-label="Control panel navigation" className="sidebar__nav" id="desktop-sidebar-navigation">
          {navigation.map((item) => (
            <NavigationLink activeHref={activeHref} collapsed={sidebarCollapsed} item={item} key={item.href} />
          ))}
        </nav>
        <div className="sidebar__secondary">
          {secondaryNavigation.map((item) => (
            <NavigationLink activeHref={activeHref} collapsed={sidebarCollapsed} item={item} key={item.href} />
          ))}
        </div>
        <div className="sidebar__footer">{footer}</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__identity">
            <button
              aria-controls="mobile-navigation-drawer"
              aria-expanded={drawerOpen}
              aria-label="Open navigation"
              className="mobile-menu-button"
              onClick={() => setDrawerOpen(true)}
              ref={menuButtonRef}
              type="button"
            >
              <Icon name="menu" size={20} />
            </button>
            <div>
              <h1>OpenCode Model Control</h1>
              <p>Local control plane for evidence-led OpenCode model routing.</p>
            </div>
          </div>
          <div className="topbar__actions">{headerActions}</div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
      <dialog
        aria-labelledby="mobile-navigation-title"
        className="mobile-drawer"
        id="mobile-navigation-drawer"
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        ref={drawerRef}
      >
        <div className="mobile-drawer__surface">
          <div className="mobile-drawer__header">
            <div>
              <div className="brand-mark" aria-hidden="true">OC</div>
              <strong id="mobile-navigation-title">Navigation</strong>
            </div>
            <button aria-label="Close navigation" className="drawer-close" onClick={closeDrawer} ref={drawerCloseButtonRef} type="button">
              <Icon name="close" size={20} />
            </button>
          </div>
          <nav aria-label="Mobile control panel navigation" className="mobile-drawer__nav">
            {navigation.map((item) => (
              <NavigationLink activeHref={activeHref} item={item} key={item.href} onNavigate={closeDrawer} />
            ))}
          </nav>
          <div className="mobile-drawer__secondary">
            {secondaryNavigation.map((item) => (
              <NavigationLink activeHref={activeHref} item={item} key={item.href} onNavigate={closeDrawer} />
            ))}
          </div>
          <div className="mobile-drawer__footer">{footer}</div>
        </div>
      </dialog>
    </div>
  );
}
