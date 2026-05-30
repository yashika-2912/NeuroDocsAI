import re

from app.models import ChatMessage, SearchResult, StructuredResponse
from app.services.concept_transformer import Concept, ConceptGraph, transform_context
from app.services.diagram_generator import detect_diagram_type
from app.services.intent_detector import ResponseType, detect_response_type, is_flashcard_intent
from app.services.llm import OpenAIChatService, fallback_answer


MERMAID_FENCE = re.compile(r"```mermaid\s*([\s\S]*?)```", re.I)


def _snippet(text: str, limit: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 3]}..."


def _table_cell(text: str, limit: int = 220) -> str:
    return _snippet(text, limit).replace("|", "\\|").replace("\n", " ")


def _citation_metadata(results: list[SearchResult]) -> dict:
    return {
        "source_count": len({result.citation.source_document for result in results}),
        "chunk_count": len(results),
    }


def _concept_metadata(graph: ConceptGraph, results: list[SearchResult]) -> dict:
    return {
        **_citation_metadata(results),
        "topic": graph.topic,
        "concept_count": len(graph.concepts),
        "concepts": [concept.name for concept in graph.concepts[:8]],
    }


def _concept_ref(concept: Concept, fallback_index: int) -> str:
    if concept.citations:
        citation = concept.citations[0]
        return f"{citation.source_document}, p. {citation.page_number}"
    return f"Concept {fallback_index}"


def validate_mermaid(content: str) -> bool:
    match = MERMAID_FENCE.search(content)
    if not match:
        return False
    code = match.group(1).strip()
    if not code:
        return False
    first_line = code.splitlines()[0].strip().lower()
    if not first_line.startswith(("graph ", "flowchart ", "mindmap", "sequencediagram")):
        return False
    if re.search(r"<script|javascript:|onerror\s*=", code, re.I):
        return False
    return True


def validate_markdown_table(content: str) -> bool:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    for index, line in enumerate(lines[:-1]):
        if (
            line.startswith("|")
            and lines[index + 1].startswith("|")
            and "---" in lines[index + 1]
            and len(lines) > index + 2
        ):
            return True
    return False


def _format_table(graph: ConceptGraph) -> str:
    rows = [
        "| Concept | What It Means | Why It Matters | Study Cue |",
        "| --- | --- | --- | --- |",
    ]
    for index, concept in enumerate(graph.concepts[:8], start=1):
        meaning = concept.summary or (concept.evidence[0] if concept.evidence else "Key idea from the retrieved material.")
        why = concept.evidence[1] if len(concept.evidence) > 1 else f"Helps explain {graph.topic}."
        cue = f"Review: {_concept_ref(concept, index)}"
        rows.append(
            f"| {_table_cell(concept.name, 80)} | {_table_cell(meaning, 180)} | {_table_cell(why, 180)} | {_table_cell(cue, 120)} |"
        )
    return "\n".join(rows)


def _format_summary(graph: ConceptGraph) -> str:
    if not graph.concepts:
        return "I could not find enough document context to summarize yet."
    lines = [
        f"### Research Summary: {graph.topic}",
        "",
        "#### Overview",
        graph.overview,
        "",
        "#### Key Concepts",
    ]
    for concept in graph.concepts[:6]:
        lines.append(f"- **{concept.name}:** {_snippet(concept.summary, 220)}")
    lines.extend(["", "#### Important Findings"])
    for concept in graph.concepts[:4]:
        finding = concept.evidence[1] if len(concept.evidence) > 1 else concept.summary
        lines.append(f"- {_snippet(finding, 240)}")
    lines.extend(
        [
            "",
            "#### Conclusions",
            f"The central takeaway is that {graph.topic} is best understood through the relationships among "
            f"{', '.join(concept.name for concept in graph.concepts[:3])}. These concepts should be reviewed together rather than memorized as isolated fragments.",
        ]
    )
    return "\n".join(lines)


def _format_flashcards(graph: ConceptGraph) -> str:
    if not graph.concepts:
        return "I could not generate flashcards because no clear concepts were found."
    lines = [f"### Flashcards: {graph.topic}", ""]
    for index, concept in enumerate(graph.concepts[:8], start=1):
        lines.extend(
            [
                f"**Card {index}**",
                f"**Q:** What is {concept.name}?",
                f"**A:** {_snippet(concept.summary, 260)}",
                "",
            ]
        )
    return "\n".join(lines).strip()


def _format_quiz(graph: ConceptGraph, flashcards: bool = False) -> str:
    if flashcards:
        return _format_flashcards(graph)
    if not graph.concepts:
        return "I could not generate a quiz because no relevant document context was found."
    lines = [f"### Concept Quiz: {graph.topic}", ""]
    concepts = graph.concepts[:5]
    for index, concept in enumerate(concepts, start=1):
        distractors = [item.name for item in concepts if item.name != concept.name][:3]
        while len(distractors) < 3:
            distractors.append(["A minor detail", "An unrelated source", "A formatting rule"][len(distractors)])
        options = [concept.name, *distractors[:3]]
        lines.extend(
            [
                f"**{index}. Which concept best matches this description?**",
                f"> {_snippet(concept.summary, 180)}",
                "",
                f"- A. {options[0]}",
                f"- B. {options[1]}",
                f"- C. {options[2]}",
                f"- D. {options[3]}",
                "",
                f"**Correct Answer:** A. {concept.name}",
                f"**Explanation:** {_snippet(concept.evidence[0] if concept.evidence else concept.summary, 240)}",
                "",
            ]
        )
    return "\n".join(lines).strip()


def _mermaid_label(text: str, limit: int = 42) -> str:
    return _snippet(text, limit).replace('"', "'").replace("(", "").replace(")", "")


def _format_mermaid(message: str, graph: ConceptGraph) -> str:
    diagram_type = detect_diagram_type(message) or "mindmap"
    concepts = graph.concepts[:7]
    if diagram_type == "flowchart":
        lines = ["```mermaid", "flowchart TD", f'    A["{_mermaid_label(graph.topic)}"]']
        previous = "A"
        for index, concept in enumerate(concepts, start=1):
            node = f"N{index}"
            lines.append(f'    {node}["{_mermaid_label(concept.name)}"]')
            lines.append(f"    {previous} --> {node}")
            previous = node
        lines.append("```")
        return "\n".join(lines)

    if diagram_type == "graph":
        lines = ["```mermaid", "graph TD", f'    ROOT["{_mermaid_label(graph.topic)}"]']
        for index, concept in enumerate(concepts, start=1):
            node = f"N{index}"
            lines.append(f'    {node}["{_mermaid_label(concept.name)}"]')
            lines.append(f"    ROOT --> {node}")
        lines.append("```")
        return "\n".join(lines)

    lines = ["```mermaid", "mindmap", f"    root(({_mermaid_label(graph.topic)}))"]
    for concept in concepts:
        lines.append(f"        {_mermaid_label(concept.name)}")
        for evidence in concept.evidence[:3]:
            lines.append(f"            {_mermaid_label(evidence, 50)}")
    lines.append("```")
    return "\n".join(lines)


def format_structured_response(
    message: str,
    history: list[ChatMessage],
    results: list[SearchResult],
) -> tuple[StructuredResponse, str, bool]:
    response_type = detect_response_type(message)
    graph = transform_context(results, message)
    citations = [result.citation for result in results]
    metadata = _concept_metadata(graph, results)
    model = "local-formatter"
    used_fallback = True

    try:
        if response_type == "table":
            content = _format_table(graph)
            if not validate_markdown_table(content):
                raise ValueError("Invalid table")
        elif response_type == "mermaid":
            content = _format_mermaid(message, graph)
            if not validate_mermaid(content):
                raise ValueError("Invalid Mermaid diagram")
        elif response_type == "quiz":
            content = _format_quiz(graph, flashcards=is_flashcard_intent(message))
        elif response_type == "summary":
            content = _format_summary(graph)
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
