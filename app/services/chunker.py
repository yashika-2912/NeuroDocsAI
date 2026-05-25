import re
from dataclasses import dataclass

from app.services.pdf_extractor import PageText


@dataclass(frozen=True)
class TextChunk:
    id: str
    text: str
    page_number: int
    section_title: str | None


SECTION_PATTERN = re.compile(r"^\s*(#{1,6}\s+)?([A-Z][A-Za-z0-9 ,:;()/-]{4,90})\s*$")


def infer_section_title(text: str, fallback: str | None = None) -> str | None:
    for line in text.splitlines()[:8]:
        candidate = line.strip()
        if SECTION_PATTERN.match(candidate) and len(candidate.split()) <= 12:
            return candidate.lstrip("#").strip()
    return fallback


def split_page_text(
    page: PageText,
    document_id: str,
    chunk_size: int,
    chunk_overlap: int,
) -> list[TextChunk]:
    if not page.text:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", page.text) if part.strip()]
    chunks: list[TextChunk] = []
    buffer = ""
    section_title = infer_section_title(page.text)

    def emit(text: str) -> None:
        if not text.strip():
            return

        chunk_index = len(chunks)
        chunks.append(
            TextChunk(
                id=f"{document_id}:p{page.page_number}:c{chunk_index}",
                text=text.strip(),
                page_number=page.page_number,
                section_title=infer_section_title(text, section_title),
            )
        )

    for paragraph in paragraphs:
        next_text = f"{buffer}\n\n{paragraph}".strip() if buffer else paragraph

        if len(next_text) <= chunk_size:
            buffer = next_text
            continue

        emit(buffer)
        overlap = buffer[-chunk_overlap:] if chunk_overlap > 0 else ""
        buffer = f"{overlap}\n\n{paragraph}".strip() if overlap else paragraph

        while len(buffer) > chunk_size:
            emit(buffer[:chunk_size])
            buffer = buffer[chunk_size - chunk_overlap :].strip()

    emit(buffer)
    return chunks


def chunk_pages(
    pages: list[PageText],
    document_id: str,
    chunk_size: int,
    chunk_overlap: int,
) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    for page in pages:
        chunks.extend(split_page_text(page, document_id, chunk_size, chunk_overlap))
    return chunks
