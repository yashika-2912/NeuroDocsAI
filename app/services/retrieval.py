from app.models import Citation, SearchResult
from app.services.vector_store import get_vector_store


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


def retrieve_relevant_chunks(query: str, top_k: int) -> list[SearchResult]:
    matches = get_vector_store().search(query=query, top_k=top_k)
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

    return results
