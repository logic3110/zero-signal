import { BookmarkCheck, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { KEYS, usePersistent } from "../lib/store";
import { useLib } from "../state/data";

export function BookmarksPage() {
  const lib = useLib();
  const [bookmarks] = usePersistent<string[]>(KEYS.bookmarks, []);
  const guides = (bookmarks ?? []).map((id) => lib.guides.get(id)).filter(Boolean);
  return (
    <div className="stack">
      <h1>Bookmarks</h1>
      {guides.length === 0 ? (
        <p className="muted">No bookmarks yet. Open a guide and tap Bookmark.</p>
      ) : (
        <ul className="list">
          {guides.map((g) => (
            <li key={g!.guide_id}>
              <Link to={`/guide/${g!.guide_id}`}>
                <BookmarkCheck size={20} aria-hidden="true" />
                <span className="grow">{g!.title}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
