from functools import lru_cache
import os
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "NeuroDocs AI"
    storage_dir: Path = Path("storage")
    uploads_dir: Path = Path("storage/uploads")
    chroma_dir: Path = Path("storage/chroma")
    documents_index_path: Path = Path("storage/documents.json")
    chat_sessions_path: Path = Path("storage/chat_sessions.json")
    vector_fallback_path: Path = Path("storage/vector_fallback.json")
    chroma_collection: str = "neurodocs_chunks"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    chunk_size: int = 1200
    chunk_overlap: int = 220
    max_upload_mb: int = 50

    def ensure_dirs(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.chroma_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
