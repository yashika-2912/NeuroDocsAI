import re

from app.models import ChatMessage, SearchResult, StructuredResponse
from app.services.diagram_generator import detect_diagram_type, generate_diagram
from app.services.intent_detector import ResponseType, detect_response_type
from app.services.llm import OpenAIChatService, fallback_answer


MERMAID_FENCE = re.compile(r"```mermaid\s*([\s\S]*?)```", re.I)


def _snippet(text: str, limit: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 3]}..."


def _citation_metadata(results: list[SearchResult]) -> dict:
    return {
        "source_count": len({result.citation.source_document for result in results}),
        "chunk_count": len(results),
    }


def validate_mermaid(content: str) -> bool:
    match = MERMAID_FENCE.search(content)
    if not match:
        return False
    code = match.group(1).strip()
    if not code:
        return False
    first_line = code.splitlines()[0].strip().lower()
    return first_line.startswith(("graph ", "flowchart ", "mindmap", "sequenceDiagram".lower()))


def validate_markdown_table(content: str) -> bool:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    for index, line in enumerate(lines[:-1]):
        if line.startswith("|") and lines[index + 1].startswith("|") and "---" in lines[index + 1]:
            return True
    return False


def _format_table(results: list[SearchResult]) -> str:
    rows = [
        "| Source | Page | Key Evidence |",
        "| --- | ---: | --- |",
    ]
    seen: set[str] = set()
    for result in results[:8]:
        key = f"{result.citation.source_document}:{result.citation.page_number}:{_snippet(result.text, 80)}"
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            f"| {result.citation.source_document} | {result.citation.page_number} | {_snippet(result.text)} |"
        )
    return "\n".join(rows)


def _format_summary(results: list[SearchResult]) -> str:
    if not results:
        return "I could not find enough document context to summarize yet."
    lines = ["### Summary"]
    for result in results[:5]:
        lines.append(f"- {_snippet(result.text, 260)} [{result.rank}]")
    return "\n".join(lines)


def _format_quiz(results: list[SearchResult]) -> str:
    if not results:
        return "I could not generate a quiz because no relevant document context was found."
    lines = ["### Quiz", ""]
    for index, result in enumerate(results[:5], start=1):
        phrase = _snippet(result.text, 140)
        answer = _snippet(result.text, 80)
        lines.extend(
            [
                f"**{index}. Which source best supports this idea?**",
                f"> {phrase}",
                "",
                f"- A. {result.citation.source_document}, page {result.citation.page_number}",
                "- B. Not enough information",
                "- C. A source outside the uploaded documents",
                "",
                f"**Answer:** A. {answer}",
                "",
            ]
        )
    return "\n".join(lines).strip()


def _format_mermaid(message: str, results: list[SearchResult]) -> str:
    diagram_type = detect_diagram_type(message) or "mindmap"
    return generate_diagram(diagram_type, message, results)


def format_structured_response(
    message: str,
    history: list[ChatMessage],
    results: list[SearchResult],
) -> tuple[StructuredResponse, str, bool]:
    response_type = detect_response_type(message)
    citations = [result.citation for result in results]
    metadata = _citation_metadata(results)
    model = "local-formatter"
    used_fallback = True

    try:
        if response_type == "table":
            content = _format_table(results)
            if not validate_markdown_table(content):
                raise ValueError("Invalid table")
        elif response_type == "mermaid":
            content = _format_mermaid(message, results)
            if not validate_mermaid(content):
                raise ValueError("Invalid Mermaid diagram")
        elif response_type == "quiz":
            content = _format_quiz(results)
        elif response_type == "summary":
            content = _format_summary(results)
        else:
            llm = OpenAIChatService()
            llm_result = llm.complete_text(message, history, results)
            content = llm_result.text
            model = llm_result.model
            used_fallback = llm_result.used_fallback

        return (
            StructuredResponse(
                type=response_type,
                content=content,
                citations=citations,
                metadata=metadata,
            ),
            model,
            used_fallback,
        )
    except Exception as exc:
        content = fallback_answer(message, results)
        return (
            StructuredResponse(
                type="text",
                content=content,
                citations=citations,
                metadata={**metadata, "fallback_reason": str(exc), "requested_type": response_type},
            ),
            model,
            True,
        )
