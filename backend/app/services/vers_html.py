import html
import re
from html.parser import HTMLParser


_STYLE_COLOR_RE = re.compile(r"(?:^|;)\s*color\s*:\s*([^;]+)", re.IGNORECASE)


def _canonical_color(style: str) -> str:
    match = _STYLE_COLOR_RE.search(str(style or ""))
    if not match:
        return ""
    color = re.sub(r"\s+", "", match.group(1).lower())
    if color in {"red", "#dc2626", "rgb(220,38,38)"}:
        return "#dc2626"
    if color in {"black", "#111827", "rgb(17,24,39)"}:
        return "#111827"
    return ""


class _VersSanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.open_spans = 0
        self.suppressed_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "svg", "math", "iframe", "object", "embed"}:
            self.suppressed_depth += 1
            return
        if self.suppressed_depth or tag != "span":
            return
        style = next((value for key, value in attrs if key.lower() == "style"), "")
        color = _canonical_color(style or "")
        if color:
            self.parts.append(f'<span style="color: {color}">')
        else:
            self.parts.append("<span>")
        self.open_spans += 1

    def handle_startendtag(self, tag: str, attrs) -> None:
        if tag.lower() == "span":
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "svg", "math", "iframe", "object", "embed"}:
            self.suppressed_depth = max(0, self.suppressed_depth - 1)
            return
        if not self.suppressed_depth and tag == "span" and self.open_spans > 0:
            self.parts.append("</span>")
            self.open_spans -= 1

    def handle_data(self, data: str) -> None:
        if not self.suppressed_depth:
            self.parts.append(html.escape(data, quote=False))

    def result(self) -> str:
        if self.open_spans:
            self.parts.extend("</span>" for _ in range(self.open_spans))
            self.open_spans = 0
        return "".join(self.parts)


def sanitize_vers_html(value) -> str:
    """Keep only text and black/red ``span`` elements for the VERS field."""
    if value is None:
        return ""
    parser = _VersSanitizer()
    try:
        parser.feed(str(value)[:10000])
        parser.close()
        return parser.result()
    except Exception:
        return html.escape(str(value)[:2000], quote=False)
