import { BookOpen, House, MessageCircleQuestion, Search, Settings, Siren, Wifi, WifiOff, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useT } from "../lib/i18n";

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

const NAV = [
  { to: "/", key: "home", Icon: House, end: true },
  { to: "/library", key: "library", Icon: BookOpen },
  { to: "/ask", key: "ask", Icon: MessageCircleQuestion },
  { to: "/tools", key: "tools", Icon: Wrench },
  { to: "/settings", key: "settings", Icon: Settings },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const t = useT();
  const online = useOnline();
  const { pathname } = useLocation();
  const onEmergency = pathname.startsWith("/emergency");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="ZeroSignal home">
          <img src="/icon.svg" alt="" />
          <span>{t("appName")}</span>
        </Link>
        <nav className="topnav" aria-label="Main">
          {NAV.map(({ to, key, Icon, ...rest }) => (
            <NavLink key={to} to={to} end={"end" in rest}>
              <Icon size={18} aria-hidden="true" />
              {t(key)}
            </NavLink>
          ))}
          <NavLink to="/search">
            <Search size={18} aria-hidden="true" />
            {t("search")}
          </NavLink>
        </nav>
        <span className="spacer" />
        <span className="net" role="status" aria-live="polite">
          {online ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
          {online ? t("online") : t("offline")}
        </span>
        {!onEmergency && (
          <Link to="/emergency" className="sos-mini" aria-label="Emergency protocol cards">
            <Siren size={18} aria-hidden="true" /> SOS
          </Link>
        )}
      </header>
      <main id="main">
        {children}
        <p className="disclaimer-bar">{t("disclaimer")}</p>
      </main>
      <nav className="tabbar" aria-label="Main">
        {NAV.map(({ to, key, Icon, ...rest }) => (
          <NavLink key={to} to={to} end={"end" in rest}>
            <Icon size={22} aria-hidden="true" />
            {t(key)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Back({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="back">
      ‹ {label}
    </Link>
  );
}
