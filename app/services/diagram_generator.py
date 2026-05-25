"""
Diagram intent detection and Mermaid syntax generation from retrieved chunks.
Works without an LLM — extracts key terms from chunk text and builds valid
Mermaid mindmap / flowchart / graph TD syntax.
"""

import re
from app.models import SearchResult

# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------

_MINDMAP_PATTERNS = re.compile(
    r"\b(mind\s*map|mindmap|concept\s*map|topic\s*map|overview|summarize\s+concept)\b",
    re.IGNORECASE,
)
_FLOWCHART_PATTERNS = re.compile(
    r"\b(flowchart|flow\s*chart|flow\s*diagram|process\s*flow|steps|procedure|algorithm|how\s+does)\b",
    re.IGNORECASE,
)
_GRAPH_PATTERNS = re.compile(
    r"\b(graph|relationship|connect|link|dependency|dependencies|architecture)\b",
    re.IGNORECASE,
)
_DIAGRAM_TRIGGER = re.compile(
    r"\b(diagram|visuali[sz]e|visuali[sz]ation|draw|chart|map|show\s+me)\b",
    re.IGNORECASE,
)


def detect_diagram_type(message: str) -> str | None:
    """
    Returns 'mindmap', 'flowchart', 'graph', or None if no diagram intent found.
    """
    if _MINDMAP_PATTERNS.search(message):
        return "mindmap"
    if _FLOWCHART_PATTERNS.search(message):
        return "flowchart"
    if _GRAPH_PATTERNS.search(message):
        return "graph"
    if _DIAGRAM_TRIGGER.search(message):
        return "mindmap"  # default to mindmap when generic diagram is requested
    return None


# ---------------------------------------------------------------------------
# Text extraction helpers
# ---------------------------------------------------------------------------

# Common stop words to filter out from key term extraction
_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "need", "dare",
    "it", "its", "this", "that", "these", "those", "i", "we", "you",
    "he", "she", "they", "them", "their", "our", "your", "my", "his",
    "her", "which", "who", "what", "when", "where", "how", "why",
    "also", "as", "if", "so", "than", "then", "there", "here",
    "not", "no", "nor", "yet", "both", "either", "each", "all",
    "any", "few", "more", "most", "other", "some", "such",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further",
    "once", "only", "own", "same", "too", "very", "just", "because",
    "while", "although", "however", "therefore", "thus", "hence",
    "used", "using", "use", "uses", "make", "makes", "made",
    "provide", "provides", "provided", "allow", "allows", "allowed",
    "called", "known", "like", "example", "examples", "including",
    "based", "given", "set", "sets", "type", "types", "way", "ways",
}

_SENTENCE_SPLIT = re.compile(r"[.!?;]\s+")
_WORD_SPLIT = re.compile(r"[^a-zA-Z0-9\s\-]")
_NUMBERED_LIST = re.compile(r"^\s*\d+[\.\)]\s+(.+)")


def _clean(text: str) -> str:
    return _WORD_SPLIT.sub(" ", text).strip()


def _extract_key_phrases(text: str, max_phrases: int = 8) -> list[str]:
    """
    Extract short meaningful phrases from a chunk of text.
    Prefers numbered list items, then falls back to sentence-level noun phrases.
    """
    phrases: list[str] = []

    # First pass: grab numbered list items (common in study notes)
    for line in text.splitlines():
        m = _NUMBERED_LIST.match(line)
        if m:
            phrase = _clean(m.group(1))
            # Take first 5 words max
            words = phrase.split()[:6]
            phrase = " ".join(words).strip()
            if len(phrase) > 3:
                phrases.append(phrase)
        if len(phrases) >= max_phrases:
            break

    if len(phrases) >= 3:
        return phrases[:max_phrases]

    # Second pass: extract from sentences — take first meaningful noun chunk
    for sentence in _SENTENCE_SPLIT.split(text):
        sentence = sentence.strip()
        if len(sentence) < 10:
            continue
        words = [w for w in sentence.split() if w.lower() not in _STOP_WORDS and len(w) > 2]
        if words:
            phrase = " ".join(words[:5])
            if phrase not in phrases:
                phrases.append(phrase)
        if len(phrases) >= max_phrases:
            break

    return phrases[:max_phrases]


def _safe_label(text: str) -> str:
    """Escape quotes and truncate for use inside Mermaid node labels."""
    text = text.replace('"', "'").replace("\n", " ").strip()
    return text[:60]


def _derive_root(message: str, results: list[SearchResult]) -> str:
    """Pick a concise root label from the user message or document title."""
    # Try to extract the topic from the message
    clean = re.sub(
        r"\b(create|generate|make|draw|show|give|build|produce|diagram|mind\s*map|"
        r"flowchart|graph|chart|map|visuali[sz]e|for|me|a|an|the|from|my|documents?)\b",
        "",
        message,
        flags=re.IGNORECASE,
    ).strip()
    clean = re.sub(r"\s+", " ", clean).strip(" .,?!")

    if len(clean) > 4:
        return _safe_label(clean[:40])

    # Fall back to document name
    if results:
        name = results[0].citation.source_document
        name = re.sub(r"\.(pdf|docx?)$", "", name, flags=re.IGNORECASE)
        return _safe_label(name[:40])

    return "Key Concepts"


# ---------------------------------------------------------------------------
# Mermaid generators
# ---------------------------------------------------------------------------

def _indent(level: int) -> str:
    return "    " * level


def generate_mindmap(message: str, results: list[SearchResult]) -> str:
    root = _derive_root(message, results)

    # Group phrases by source document
    doc_phrases: dict[str, list[str]] = {}
    seen_phrases: set[str] = set()

    for result in results[:5]:
        doc = result.citation.source_document
        doc_label = re.sub(r"\.(pdf|docx?)$", "", doc, flags=re.IGNORECASE)[:35]
        phrases = _extract_key_phrases(result.text, max_phrases=5)
        for phrase in phrases:
            key = phrase.lower()
            if key not in seen_phrases:
                seen_phrases.add(key)
                doc_phrases.setdefault(doc_label, []).append(phrase)

    lines = ["```mermaid", "mindmap", f'{_indent(1)}root(({root}))']

    for doc_label, phrases in list(doc_phrases.items())[:3]:
        lines.append(f"{_indent(2)}{doc_label}")
        for phrase in phrases[:4]:
            lines.append(f"{_indent(3)}{_safe_label(phrase)}")

    lines.append("```")
    return "\n".join(lines)


def generate_flowchart(message: str, results: list[SearchResult]) -> str:
    root = _derive_root(message, results)

    all_phrases: list[str] = []
    seen: set[str] = set()
    for result in results[:4]:
        for phrase in _extract_key_phrases(result.text, max_phrases=4):
            key = phrase.lower()
            if key not in seen:
                seen.add(key)
                all_phrases.append(phrase)

    lines = ["```mermaid", "flowchart TD"]
    lines.append(f'    A["{_safe_label(root)}"]')

    node_ids = "BCDEFGHIJKLMNOP"
    prev = "A"
    for i, phrase in enumerate(all_phrases[:8]):
        nid = node_ids[i]
        lines.append(f'    {nid}["{_safe_label(phrase)}"]')
        lines.append(f"    {prev} --> {nid}")
        prev = nid

    lines.append("```")
    return "\n".join(lines)


def generate_graph(message: str, results: list[SearchResult]) -> str:
    root = _derive_root(message, results)

    all_phrases: list[str] = []
    seen: set[str] = set()
    for result in results[:4]:
        for phrase in _extract_key_phrases(result.text, max_phrases=4):
            key = phrase.lower()
            if key not in seen:
                seen.add(key)
                all_phrases.append(phrase)

    lines = ["```mermaid", "graph TD"]
    lines.append(f'    ROOT["{_safe_label(root)}"]')

    node_ids = "ABCDEFGHIJKLMNOP"
    for i, phrase in enumerate(all_phrases[:8]):
        nid = node_ids[i]
        lines.append(f'    {nid}["{_safe_label(phrase)}"]')
        lines.append(f"    ROOT --> {nid}")

    lines.append("```")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_diagram(diagram_type: str, message: str, results: list[SearchResult]) -> str:
    """Generate Mermaid syntax for the given diagram type from retrieved chunks."""
    if diagram_type == "flowchart":
        return generate_flowchart(message, results)
    if diagram_type == "graph":
        return generate_graph(message, results)
    return generate_mindmap(message, results)  # default: mindmap
