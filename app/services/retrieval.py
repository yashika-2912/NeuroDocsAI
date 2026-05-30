import math
import re
from collections import defaultdict

from app.models import Citation, SearchResult
from app.services.vector_store import get_vector_store

TOKEN_PATTERN = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]+")


def distance_to_score(distance: float | None) -> float | None:
    if distance is None:
        return None

    return max(0.0, min(1.0, 1.0 - distance))


def build_citation(chunk_id: str, metadata: dict) -> Citation:
    source_document = metadata["source_document"]
    page_number = int(metadata["page_number"])
    section_title = metadata.get("section_title") or None
    location = f"p. {page_number}"
    if section_title:
        location = f"{location}, {section_title}"

    return Citation(
        document_id=metadata["document_id"],
        source_document=source_document,
        page_number=page_number,
        section_title=section_title,
        chunk_id=chunk_id,
        label=f"{source_document} ({location})",
    )


def _token_set(text: str) -> set[str]:
    return {
        token.lower().rstrip("s")
        for token in TOKEN_PATTERN.findall(text)
        if len(token) > 2
    }


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def diversify_results(results: list[SearchResult], top_k: int) -> list[SearchResult]:
    selected: list[SearchResult] = []
    selected_tokens: list[set[str]] = []
    per_document: dict[str, int] = defaultdict(int)
    max_per_document = max(1, math.ceil(top_k / 2))

    for result in results:
        tokens = _token_set(result.text)
        if any(_jaccard(tokens, existing) >= 0.82 for existing in selected_tokens):
            continue
        if per_document[result.citation.document_id] >= max_per_document and len(selected) < top_k - 1:
            continue

        selected.append(result)
        selected_tokens.append(tokens)
        per_document[result.citation.document_id] += 1

        if len(selected) >= top_k:
            break

    if len(selected) < top_k:
        selected_ids = {result.chunk_id for result in selected}
        for result in results:
            if result.chunk_id not in selected_ids:
                selected.append(result)
            if len(selected) >= top_k:
                break

    for rank, result in enumerate(selected, start=1):
        result.rank = rank
    return selected[:top_k]


def retrieve_relevant_chunks(query: str, top_k: int) -> list[SearchResult]:
    candidate_count = min(max(top_k * 4, top_k), 50)
    matches = get_vector_store().search(query=query, top_k=candidate_count)
    results: list[SearchResult] = []

    for index, match in enumerate(matches, start=1):
        citation = build_citation(match["chunk_id"], match["metadata"])
        results.append(
            SearchResult(
                rank=index,
                chunk_id=match["chunk_id"],
                text=match["text"],
                citation=citation,
                distance=match["distance"],
                score=distance_to_score(match["distance"]),
            )
        )

    return diversify_results(results, top_k)
