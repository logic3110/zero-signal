import {
  Bookmark, BookOpen, Car, ChevronRight, Compass, Flashlight, MapPin, MessageCircleQuestion, MessageSquareText,
  Package, Phone, Search, Siren, Stethoscope, Tent,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { KEYS, usePersistent } from "../lib/store";
import { useLib } from "../state/data";

export function Home() {
  const t = useT();
  const lib = useLib();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [recents] = usePersistent<string[]>(KEYS.recents, []);
  const [bookmarks] = usePersistent<string[]>(KEYS.bookmarks, []);
  const recentGuides = (recents ?? []).map((id) => lib.guides.get(id)).filter(Boolean).slice(0, 5);

  return (
    <div className="stack">
      <Link to="/emergency" className="emergency-btn" aria-label="Emergency: open protocol cards">
        <Siren size={52} aria-hidden="true" />
        <span>
          <strong>{t("emergency")}</strong>
          {t("emergencySub")}
        </span>
      </Link>

      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label htmlFor="home-q" className="sr-only">
          {t("search")}
        </label>
        <input id="home-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} />
        <button className="btn primary" aria-label={t("search")}>
          <Search aria-hidden="true" />
        </button>
      </form>

      <Link to="/ask" className="tile" style={{ flexDirection: "row", alignItems: "center", minHeight: 72 }}>
        <MessageCircleQuestion size={32} aria-hidden="true" />
        <span style={{ flex: 1 }}>
          Ask a question
          <div className="muted small">Cited step-by-step answers from the library</div>
        </span>
        <ChevronRight aria-hidden="true" />
      </Link>

      <section className="section" aria-labelledby="lib-h">
        <h2 id="lib-h">{t("library")}</h2>
        <div className="grid">
          <Link to="/library/medical" className="tile">
            <Stethoscope aria-hidden="true" /> {t("medical")}
            <span className="muted small">{lib.guideList.filter((g) => g.domain === "medical").length} guides</span>
          </Link>
          <Link to="/library/survival" className="tile">
            <Tent aria-hidden="true" /> {t("survival")}
            <span className="muted small">{lib.guideList.filter((g) => g.domain === "survival").length} guides</span>
          </Link>
          <Link to="/library/vehicle" className="tile">
            <Car aria-hidden="true" /> {t("vehicle")}
            <span className="muted small">{lib.guideList.filter((g) => g.domain === "vehicle").length} guides</span>
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="tools-h">
        <h2 id="tools-h">{t("tools")}</h2>
        <div className="grid">
          <Link to="/tools/flashlight" className="tile">
            <Flashlight aria-hidden="true" /> SOS light
          </Link>
          <Link to="/tools/sos" className="tile">
            <MessageSquareText aria-hidden="true" /> SOS message
          </Link>
          <Link to="/tools/location" className="tile">
            <MapPin aria-hidden="true" /> My location
          </Link>
          <Link to="/tools/compass" className="tile">
            <Compass aria-hidden="true" /> Compass
          </Link>
          <Link to="/tools/numbers" className="tile">
            <Phone aria-hidden="true" /> Emergency numbers
          </Link>
          <Link to="/supplies" className="tile">
            <Package aria-hidden="true" /> {t("supplies")}
          </Link>
        </div>
      </section>

      {recentGuides.length > 0 && (
        <section className="section" aria-labelledby="recent-h">
          <h2 id="recent-h">{t("recent")}</h2>
          <ul className="list">
            {recentGuides.map((g) => (
              <li key={g!.guide_id}>
                <Link to={`/guide/${g!.guide_id}`}>
                  <BookOpen size={20} aria-hidden="true" />
                  <span className="grow">{g!.title}</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(bookmarks ?? []).length > 0 && (
        <Link to="/bookmarks" className="btn block">
          <Bookmark aria-hidden="true" /> {t("bookmarks")} ({bookmarks.length})
        </Link>
      )}
    </div>
  );
}
