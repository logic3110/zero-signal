import { Bookmark, BookmarkCheck, OctagonAlert, Printer, Siren, TriangleAlert, Volume2 } from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Back } from "../components/Layout";
import { Markdown } from "../components/Markdown";
import { SeverityBadge } from "../components/icons";
import { SourcesList } from "../components/Sources";
import { speak } from "../lib/format";
import { KEYS, usePersistent } from "../lib/store";
import { slug } from "../lib/text";
import { useLib } from "../state/data";

function sections(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let heading = "Overview";
  let buf: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (buf.join("").trim()) out.push({ heading, text: buf.join("\n").trim() });
      heading = m[1].trim();
      buf = [];
    } else buf.push(line);
  }
  if (buf.join("").trim()) out.push({ heading, text: buf.join("\n").trim() });
  return out;
}

const STYLE: Record<string, { cls: string; Icon?: typeof TriangleAlert }> = {
  warnings: { cls: "notice warn", Icon: TriangleAlert },
  "red flags": { cls: "notice danger", Icon: OctagonAlert },
  "when to get help": { cls: "notice" },
};

/** Guide view (US-2.2): steps, warnings, red flags, help, sources, review. */
export function GuidePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const lib = useLib();
  const guide = id ? lib.guides.get(id) : undefined;
  const [bookmarks, setBookmarks] = usePersistent<string[]>(KEYS.bookmarks, []);
  const [, setRecents] = usePersistent<string[]>(KEYS.recents, []);
  const target = params.get("section");

  useEffect(() => {
    if (!guide) return;
    setRecents((prev) => [guide.guide_id, ...(prev ?? []).filter((x) => x !== guide.guide_id)].slice(0, 20));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide?.guide_id]);

  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(`sec-${slug(target)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("highlight");
    const t = setTimeout(() => el.classList.remove("highlight"), 4000);
    return () => clearTimeout(t);
  }, [target, guide?.guide_id]);

  if (!guide) return <Navigate to="/library" replace />;
  const marked = (bookmarks ?? []).includes(guide.guide_id);
  const card = guide.protocol_card ? lib.cardById.get(guide.protocol_card) : undefined;

  return (
    <article className="stack">
      <Back to={`/library/${guide.domain}`} label={guide.category} />
      <header>
        <div className="row" style={{ marginBottom: "0.4rem" }}>
          <SeverityBadge severity={guide.severity} />
          <span className="muted small">{guide.category}</span>
        </div>
        <h1>{guide.title}</h1>
        <p id="sec-summary" className="guide-section" style={{ fontSize: "1.1rem" }}>
          {guide.summary}
        </p>
        <div className="row">
          <button
            className="btn"
            aria-pressed={marked}
            onClick={() =>
              setBookmarks((prev) =>
                marked ? (prev ?? []).filter((x) => x !== guide.guide_id) : [guide.guide_id, ...(prev ?? [])],
              )
            }
          >
            {marked ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
            {marked ? "Bookmarked" : "Bookmark"}
          </button>
          <button className="btn" onClick={() => speak(`${guide.title}. ${guide.steps.map((s, i) => `Step ${i + 1}. ${s}`).join(" ")}`)}>
            <Volume2 aria-hidden="true" /> Read steps
          </button>
          <button className="btn ghost" onClick={() => window.print()} aria-label="Print or save as PDF">
            <Printer aria-hidden="true" />
          </button>
        </div>
      </header>

      {card && (
        <Link to={`/emergency/${card.card_id}`} className="card-tile" style={{ flexDirection: "row", alignItems: "center", minHeight: 64 }}>
          <Siren aria-hidden="true" /> Emergency card: {card.title}
        </Link>
      )}

      {sections(guide.body_md).map(({ heading, text }) => {
        const style = STYLE[heading.toLowerCase()];
        const Icon = style?.Icon;
        return (
          <section key={heading} id={`sec-${slug(heading)}`} className="guide-section section">
            <h2>{heading}</h2>
            {style ? (
              <div className={style.cls}>
                {Icon && <Icon size={20} aria-hidden="true" />}
                <div style={{ flex: 1 }}>
                  <Markdown text={text} />
                </div>
              </div>
            ) : (
              <Markdown text={text} />
            )}
          </section>
        );
      })}

      <SourcesList ids={guide.sources} reviewed={{ role: guide.reviewer_role, date: guide.last_reviewed }} />
    </article>
  );
}
