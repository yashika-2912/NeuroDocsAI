import re
from dataclasses import dataclass
from pathlib import Path

import fitz


@dataclass(frozen=True)
class PageText:
    page_number: int
    text: str


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_text(path: Path) -> list[PageText]:
    pages: list[PageText] = []

    with fitz.open(path) as document:
        for index, page in enumerate(document, start=1):
            text = clean_text(page.get_text("text"))
            pages.append(PageText(page_number=index, text=text))

    return pages
