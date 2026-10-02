"""Raw source-document parsers (US-15.2).

Each parser returns a list of ``Section(path, text)`` where ``path`` is the
heading trail, so the chunker can stay structure-aware regardless of the
input format. Heavy parsers are optional extras and imported lazily; HTML,
Markdown and plain text work with the standard library alone.
"""

from __future__ import annotations

import re
import urllib.robotparser
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

from .guides import split_sections


@dataclass
class Section:
    path: list[str]
    text: str


class MissingParserError(RuntimeError):
    pass


def _need(module: str, extra: str = "parsers"):
    try:
        return __import__(module)
    except ImportError as exc:  # pragma: no cover - depends on env
        raise MissingParserError(
            f"'{module}' is required for this source; install with: pip install 'zerosignal[{extra}]'"
        ) from exc


# --------------------------------------------------------------------------- md
def parse_markdown(text: str, title: str) -> list[Section]:
    text = re.sub(r"\A---\s*\n.*?\n---\s*\n", "", text, flags=re.S)
    return [Section([title, h], t) for h, t in split_sections(text)]


def parse_text(text: str, title: str) -> list[Section]:
    return [Section([title], text.strip())] if text.strip() else []


# ------------------------------------------------------------------------- html
class _HeadingHTML(HTMLParser):
    """Stdlib fallback: collects text under h1-h3, keeps <li> as list items."""

    SKIP = {"script", "style", "nav", "footer", "header", "aside", "noscript"}

    def __init__(self) -> None:
        super().__init__()
        self.sections: list[tuple[list[str], list[str]]] = [([], [])]
        self.trail: list[str] = []
        self._skip = 0
        self._heading: int | None = None
        self._hbuf: list[str] = []
        self._ol_counter: list[int] = []
        self._line: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag in ("h1", "h2", "h3"):
            self._flush()
            self._heading, self._hbuf = int(tag[1]), []
        elif tag == "ol":
            self._ol_counter.append(0)
        elif tag == "ul":
            self._ol_counter.append(-1)
        elif tag == "li":
            self._flush()
            if self._ol_counter and self._ol_counter[-1] >= 0:
                self._ol_counter[-1] += 1
                self._line.append(f"{self._ol_counter[-1]}. ")
            else:
                self._line.append("- ")
        elif tag in ("p", "br", "div", "tr"):
            self._flush()

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
        elif self._heading and tag == f"h{self._heading}":
            title = " ".join("".join(self._hbuf).split())
            level = self._heading
            self.trail = self.trail[: level - 1] + [title]
            self.sections.append((list(self.trail), []))
            self._heading = None
        elif tag in ("ol", "ul") and self._ol_counter:
            self._ol_counter.pop()
            self._flush()
        elif tag in ("p", "li", "div", "tr"):
            self._flush()

    def handle_data(self, data):
        if self._skip:
            return
        if self._heading:
            self._hbuf.append(data)
        else:
            self._line.append(data)

    def _flush(self):
        line = " ".join("".join(self._line).split())
        if line and line not in ("-", "1."):
            self.sections[-1][1].append(line)
        self._line = []


def parse_html(html: str, title: str) -> list[Section]:
    parser = _HeadingHTML()
    parser.feed(html)
    parser.close()
    parser._flush()
    out = []
    for trail, lines in parser.sections:
        body = "\n".join(lines).strip()
        if body:
            out.append(Section([title, *trail], body))
    return out


# ----------------------------------------------------------------- pdf/epub/docx
def parse_pdf(path: Path, title: str, ocr: bool = False) -> list[Section]:
    fitz = _need("fitz")
    sections: list[Section] = []
    with fitz.open(path) as doc:
        toc = {page: t for _lvl, t, page in doc.get_toc(simple=True)}
        current = title
        for i, page in enumerate(doc, start=1):
            current = toc.get(i, current)
            text = page.get_text("text")
            if ocr and len(text.strip()) < 20:
                pytesseract = _need("pytesseract")
                from PIL import Image  # pytesseract dependency

                pix = page.get_pixmap(dpi=300)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                text = pytesseract.image_to_string(img)
            if text.strip():
                sections.append(Section([title, current, f"p.{i}"], text.strip()))
    return sections


def parse_epub(path: Path, title: str) -> list[Section]:
    epub = _need("ebooklib.epub").epub
    import ebooklib

    book = epub.read_epub(str(path))
    out: list[Section] = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        out.extend(parse_html(item.get_content().decode("utf-8", "ignore"), title))
    return out


def parse_docx(path: Path, title: str) -> list[Section]:
    docx = _need("docx")
    doc = docx.Document(str(path))
    out: list[Section] = []
    trail: list[str] = []
    buf: list[str] = []
    n = 0
    for para in doc.paragraphs:
        style = (para.style.name or "").lower()
        text = para.text.strip()
        if not text:
            continue
        if style.startswith("heading"):
            if buf:
                out.append(Section([title, *trail], "\n".join(buf)))
            level = int(re.sub(r"\D", "", style) or 1)
            trail, buf, n = trail[: level - 1] + [text], [], 0
        elif "list number" in style:
            n += 1
            buf.append(f"{n}. {text}")
        elif "list" in style:
            buf.append(f"- {text}")
        else:
            n = 0
            buf.append(text)
    if buf:
        out.append(Section([title, *trail], "\n".join(buf)))
    return out


# ------------------------------------------------------------------------ fetch
def robots_allowed(url: str, user_agent: str = "ZeroSignalBuilder") -> bool:
    parts = urlparse(url)
    rp = urllib.robotparser.RobotFileParser(f"{parts.scheme}://{parts.netloc}/robots.txt")
    try:
        rp.read()
    except OSError:
        return False
    return rp.can_fetch(user_agent, url)


def fetch_url(url: str) -> str:
    """Fetch an HTML source, refusing if robots.txt disallows it."""
    import httpx

    if not robots_allowed(url):
        raise PermissionError(f"robots.txt disallows fetching {url}")
    resp = httpx.get(url, headers={"User-Agent": "ZeroSignalBuilder/0.1"}, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    try:
        trafilatura = __import__("trafilatura")
        extracted = trafilatura.extract(resp.text, output_format="html", include_formatting=True)
        if extracted:
            return extracted
    except ImportError:
        pass
    return resp.text


def parse_document(path_or_url: str, fmt: str, title: str, base: Path, ocr: bool = False) -> list[Section]:
    if path_or_url.startswith(("http://", "https://")):
        return parse_html(fetch_url(path_or_url), title)
    path = (base / path_or_url).resolve()
    if fmt == "auto":
        fmt = path.suffix.lstrip(".").lower()
        fmt = {"htm": "html", "markdown": "md"}.get(fmt, fmt)
    if fmt == "md":
        return parse_markdown(path.read_text(encoding="utf-8"), title)
    if fmt == "txt":
        return parse_text(path.read_text(encoding="utf-8"), title)
    if fmt == "html":
        return parse_html(path.read_text(encoding="utf-8", errors="ignore"), title)
    if fmt == "pdf":
        return parse_pdf(path, title, ocr=ocr)
    if fmt == "epub":
        return parse_epub(path, title)
    if fmt == "docx":
        return parse_docx(path, title)
    raise ValueError(f"unsupported document format: {fmt}")
