import json
from pathlib import Path

from app.models import DocumentRecord


class DocumentStore:
    def __init__(self, index_path: Path) -> None:
        self.index_path = index_path

    def list_documents(self) -> list[DocumentRecord]:
        if not self.index_path.exists():
            return []

        with self.index_path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)

        return [DocumentRecord.model_validate(item) for item in raw]

    def add_document(self, document: DocumentRecord) -> None:
        documents = self.list_documents()
        documents.append(document)
        self.index_path.parent.mkdir(parents=True, exist_ok=True)

        with self.index_path.open("w", encoding="utf-8") as handle:
            json.dump(
                [item.model_dump(mode="json") for item in documents],
                handle,
                ensure_ascii=True,
                indent=2,
            )
