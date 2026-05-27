from collections.abc import Iterator

from app.config import get_settings
from app.models import ChatMessage, SearchResult


SYSTEM_PROMPT = """You are NeuroDocs AI, a careful multi-document research assistant.
Answer only from the provided retrieved PDF context and the recent conversation.
If the context is insufficient, say what is missing instead of inventing details.
Use concise, helpful prose and include citation markers like [1], [2] when using sources.
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


def build_input(message: str, history: list[ChatMessage], results: list[SearchResult]) -> list[dict]:
    recent_history = history[-8:]
    input_messages: list[dict] = []

    for item in recent_history:
        input_messages.append({"role": item.role, "content": item.content})

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

    def complete_text(self, message: str, history: list[ChatMessage], results: list[SearchResult]) -> LLMResult:
        if self.client is None:
            return LLMResult(fallback_answer(message, results), self.model, True)

        response = self.client.responses.create(
            model=self.model,
            instructions=SYSTEM_PROMPT,
            input=build_input(message, history, results),
        )
        return LLMResult(response.output_text, self.model, False)

    def complete(self, message: str, history: list[ChatMessage], results: list[SearchResult]) -> LLMResult:
        return self.complete_text(message, history, results)

    def stream(self, message: str, history: list[ChatMessage], results: list[SearchResult]) -> Iterator[str]:
        if self.client is None:
            yield from self._fallback_stream(message, results)
            return

        try:
            stream = self.client.responses.create(
                model=self.model,
                instructions=SYSTEM_PROMPT,
                input=build_input(message, history, results),
                stream=True,
            )
            for event in stream:
                if event.type == "response.output_text.delta":
                    yield event.delta
        except Exception:
            yield from self._fallback_stream(message, results)

    def _fallback_stream(
        self,
        message: str,
        results: list[SearchResult],
    ) -> Iterator[str]:
        text = fallback_answer(message, results)
        for word in text.split(" "):
            yield f"{word} "
