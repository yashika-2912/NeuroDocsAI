import re
from typing import Literal

ResponseType = Literal["text", "table", "mermaid", "quiz", "summary"]

TABLE_PATTERN = re.compile(r"\b(compare|comparison|versus|vs\.?|table|differences?|similarities?)\b", re.I)
MERMAID_PATTERN = re.compile(r"\b(mind\s*map|mindmap|flow\s*chart|flowchart|diagram|mermaid|visuali[sz]e|concept\s*map)\b", re.I)
QUIZ_PATTERN = re.compile(r"\b(quiz|mcq|multiple\s+choice|questions?|test\s+me|flashcards?)\b", re.I)
FLASHCARD_PATTERN = re.compile(r"\b(flashcards?|cards?|active\s+recall)\b", re.I)
SUMMARY_PATTERN = re.compile(r"\b(summary|summarize|summarise|key\s+points|brief|overview|research\s+summary)\b", re.I)


def detect_response_type(message: str) -> ResponseType:
    if TABLE_PATTERN.search(message):
        return "table"
    if MERMAID_PATTERN.search(message):
        return "mermaid"
    if QUIZ_PATTERN.search(message):
        return "quiz"
    if SUMMARY_PATTERN.search(message):
        return "summary"
    return "text"


def is_flashcard_intent(message: str) -> bool:
    return bool(FLASHCARD_PATTERN.search(message))
