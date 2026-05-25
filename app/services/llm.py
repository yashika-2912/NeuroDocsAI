from collections.abc import Iterator

from app.config import get_settings
from app.models import ChatMessage, SearchResult
from app.services.diagram_generator import detect_diagram_type, generate_diagram


SYSTEM_PROMPT = """You are NeuroDocs AI, a careful multi-document research assistant.
Answer only from the provided retrieved PDF context and the recent conversation.
If the context is insufficient, say what is missing instead of inventing details.
Use concise, helpful prose and include citation markers like [1], [2] when using sources.
"""

DIAGRAM_SYSTEM_PROMPT = """You are NeuroDocs AI, a multi-document research assistant that creates visual diagrams.
Using ONLY the provided retrieved PDF context, generate a Mermaid diagram that captures the key concepts.

Rules:
- Output ONLY valid Mermaid syntax inside a fenced code block: ```mermaid ... ```
- After the diagram, add a brief 1-2 sentence explanation of what it shows.
- Do not invent concepts not present in the context.
- Use the diagram type specified in the user message (mindmap, flowchart, or graph TD).
- Keep node labels short (max 5 words each).
- For mindmap: use indentation-based syntax with root((...)).
- For flowchart/graph: use TD direction with quoted labels.
"""


class LLMResult:
    def __init__(self, text: str, model: str, used_fallback: bool) -> None:
        self.text = text
        self.model = model
        self.used_fallback = used_fallback


def build_context(results: list[SearchResult]) -> str:
    lines: list[str] = []
    for result in results:
        lines.append(
            "\n".join(
                [
                    f"[{result.rank}] {result.citation.label}",
                    result.text,
                ]
            )
        )
    return "\n\n".join(lines)


def build_input(
    message: str,
    history: list[ChatMessage],
    results: list[SearchResult],
    diagram_type: str | None = None,
) -> list[dict]:
    recent_history = history[-8:]
    input_messages: list[dict] = []

    for item in recent_history:
        input_messages.append({"role": item.role, "content": item.content})

    # When generating a diagram, be explicit about the format expected
    if diagram_type:
        user_content = (
            f"Generate a Mermaid {diagram_type} diagram for: {message}\n\n"
            f"Retrieved PDF context:\n{build_context(results) or 'No relevant chunks were retrieved.'}"
        )
    else:
        user_content = (
            f"Question:\n{message}\n\n"
            f"Retrieved PDF context:\n{build_context(results) or 'No relevant chunks were retrieved.'}"
        )

    input_messages.append({"role": "user", "content": user_content})
    return input_messages


def fallback_answer(message: str, results: list[SearchResult]) -> str:
    if not results:
        return (
            "I could not find relevant content in your documents for that question. "
            "Try uploading more documents or rephrasing your query."
        )

    # Deduplicate chunks by source document to avoid repeating the same passage
    seen: set[str] = set()
    unique_results: list[SearchResult] = []
    for result in results:
        key = result.text.strip()[:120]
        if key not in seen:
            seen.add(key)
            unique_results.append(result)

    parts = ["Here is what I found in your documents:\n"]
    for result in unique_results[:3]:
        snippet = result.text.strip()
        if len(snippet) > 500:
            snippet = f"{snippet[:497]}..."
        parts.append(f"**{result.citation.source_document}** (p. {result.citation.page_number})\n\n{snippet}")

    return "\n\n---\n\n".join(parts)


class OpenAIChatService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = None

        if self.settings.openai_api_key:
            try:
                from openai import OpenAI
                self.client = OpenAI(api_key=self.settings.openai_api_key)
            except Exception:
                self.client = None

    @property
    def model(self) -> str:
        return self.settings.openai_model

    def complete(self, message: str, history: list[ChatMessage], results: list[SearchResult]) -> LLMResult:
        diagram_type = detect_diagram_type(message)

        if self.client is None:
            if diagram_type:
                text = generate_diagram(diagram_type, message, results)
            else:
                text = fallback_answer(message, results)
            return LLMResult(text, self.model, True)

        system = DIAGRAM_SYSTEM_PROMPT if diagram_type else SYSTEM_PROMPT
        response = self.client.responses.create(
            model=self.model,
            instructions=system,
            input=build_input(message, history, results, diagram_type),
        )
        return LLMResult(response.output_text, self.model, False)

    def stream(self, message: str, history: list[ChatMessage], results: list[SearchResult]) -> Iterator[str]:
        diagram_type = detect_diagram_type(message)

        if self.client is None:
            yield from self._fallback_stream(message, results, diagram_type)
            return

        try:
            system = DIAGRAM_SYSTEM_PROMPT if diagram_type else SYSTEM_PROMPT
            stream = self.client.responses.create(
                model=self.model,
                instructions=system,
                input=build_input(message, history, results, diagram_type),
                stream=True,
            )
            for event in stream:
                if event.type == "response.output_text.delta":
                    yield event.delta
        except Exception:
            yield from self._fallback_stream(message, results, diagram_type)

    def _fallback_stream(
        self,
        message: str,
        results: list[SearchResult],
        diagram_type: str | None = None,
    ) -> Iterator[str]:
        if diagram_type:
            text = generate_diagram(diagram_type, message, results)
        else:
            text = fallback_answer(message, results)
        for word in text.split(" "):
            yield f"{word} "
