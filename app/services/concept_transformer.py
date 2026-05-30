import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from app.models import Citation, SearchResult

TOKEN_PATTERN = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]+")
SENTENCE_PATTERN = re.compile(r"(?<=[.!?])\s+|\n+")
HEADING_PATTERN = re.compile(r"^\s*(#{1,6}\s*)?([A-Z][A-Za-z0-9 /:;()_-]{3,80})\s*$")

STOP_WORDS = {
    "about", "above", "after", "again", "against", "also", "although", "among",
    "and", "any", "are", "because", "been", "before", "being", "between", "both",
    "but", "can", "could", "did", "does", "doing", "each", "few", "for", "from",
    "had", "has", "have", "having", "here", "how", "into", "its", "itself", "just",
    "like", "more", "most", "not", "now", "off", "once", "only", "other", "our",
    "out", "over", "own", "same", "should", "some", "such", "than", "that", "the",
    "their", "them", "then", "there", "these", "they", "this", "those", "through",
    "too", "under", "until", "very", "was", "were", "what", "when", "where", "which",
    "while", "who", "why", "will", "with", "would", "your", "using", "used", "use",
    "example", "examples", "document", "documents", "source", "sources", "page",
}


@dataclass
class Concept:
    name: str
    summary: str
    evidence: list[str] = field(default_factory=list)
    citations: list[Citation] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)


@dataclass
class ConceptGraph:
    topic: str
    overview: str
    concepts: list[Concept]
    citations: list[Citation]


def _tokens(text: str) -> list[str]:
    return [
        token.lower().replace("-", " ")
        for token in TOKEN_PATTERN.findall(text)
        if len(token) > 2 and token.lower() not in STOP_WORDS
    ]


def _safe_sentence(text: str, limit: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip(" -*\t")
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 3]}..."


def _extract_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    for part in SENTENCE_PATTERN.split(text):
        sentence = _safe_sentence(part)
        if len(sentence.split()) >= 5:
            sentences.append(sentence)
    return sentences


def _extract_headings(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines()[:12]:
        match = HEADING_PATTERN.match(line)
        if match:
            heading = match.group(2).strip()
            if 2 <= len(heading.split()) <= 8:
                headings.append(heading)
    return headings


def _humanize_keyword(keyword: str) -> str:
    return " ".join(part.capitalize() for part in keyword.split())


def _derive_topic(query: str, concepts: list[Concept]) -> str:
    stripped = re.sub(
        r"\b(create|generate|make|show|compare|quiz|mcq|summary|summarize|mind\s*map|flowchart|diagram|table|from|about|the|a|an|documents?)\b",
        "",
        query,
        flags=re.I,
    )
    stripped = re.sub(r"\s+", " ", stripped).strip(" ?.,")
    if len(stripped) >= 4:
        return stripped.title()
    if concepts:
        return concepts[0].name
    return "Key Concepts"


def transform_context(results: list[SearchResult], query: str) -> ConceptGraph:
    sentence_rows: list[tuple[str, SearchResult]] = []
    heading_rows: list[tuple[str, SearchResult]] = []

    for result in results:
        for heading in _extract_headings(result.text):
            heading_rows.append((heading, result))
        for sentence in _extract_sentences(result.text):
            sentence_rows.append((sentence, result))

    token_counts = Counter()
    for sentence, _ in sentence_rows:
        token_counts.update(_tokens(sentence))

    candidate_names = [heading for heading, _ in heading_rows]
    candidate_names.extend(_humanize_keyword(token) for token, _ in token_counts.most_common(12))

    concepts_by_key: dict[str, Concept] = {}
    evidence_by_key: dict[str, list[tuple[str, SearchResult]]] = defaultdict(list)

    for name in candidate_names:
        key_tokens = _tokens(name)
        if not key_tokens:
            continue
        key = key_tokens[0]
        concepts_by_key.setdefault(
            key,
            Concept(name=_safe_sentence(name, 64), summary="", keywords=key_tokens[:4]),
        )

    if not concepts_by_key and sentence_rows:
        for token, _ in token_counts.most_common(5):
            concepts_by_key[token] = Concept(name=_humanize_keyword(token), summary="", keywords=[token])

    for sentence, result in sentence_rows:
        sentence_tokens = set(_tokens(sentence))
        for key, concept in concepts_by_key.items():
            concept_tokens = set(concept.keywords or [key])
            if key in sentence_tokens or sentence_tokens & concept_tokens:
                evidence_by_key[key].append((sentence, result))
                break

    concepts: list[Concept] = []
    for key, concept in concepts_by_key.items():
        rows = evidence_by_key.get(key, [])
        if not rows:
            continue
        seen_evidence: set[str] = set()
        for sentence, result in rows[:4]:
            if sentence.lower() in seen_evidence:
                continue
            seen_evidence.add(sentence.lower())
            concept.evidence.append(sentence)
            if result.citation not in concept.citations:
                concept.citations.append(result.citation)
        if concept.evidence:
            concept.summary = _safe_sentence(concept.evidence[0], 180)
            concepts.append(concept)

    concepts = concepts[:8]
    citations = []
    for result in results:
        if result.citation not in citations:
            citations.append(result.citation)

    topic = _derive_topic(query, concepts)
    overview = _safe_sentence(
        " ".join(concept.summary for concept in concepts[:3]),
        420,
    )
    if not overview:
        overview = "The retrieved context did not contain enough conceptual material to transform."

    return ConceptGraph(topic=topic, overview=overview, concepts=concepts, citations=citations)
