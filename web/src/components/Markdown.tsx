import { Fragment, type ReactNode } from "react";

/** Minimal Markdown for guide bodies: paragraphs, ordered/unordered lists,
 *  **bold**. Content is trusted pack data but rendered without innerHTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line) || /^\s*[-*]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = lines[i].match(/^\s*(?:\d+[.)]|[-*])\s+(.*)$/);
        if (m) items.push(m[1]);
        else if (items.length) items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={ordered ? "guide-steps" : "bullets"}>
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\d+[.)]|[-*])\s+/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
  }
  return <>{blocks}</>;
}
