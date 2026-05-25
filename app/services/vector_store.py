import hashlib
import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.config import get_settings
from app.services.chunker import TextChunk


class VectorBackend(Protocol):
    name: str

    def add_chunks(self, document_id: str, filename: str, chunks: list[TextChunk]) -> None:
        ...

    def search(self, query: str, top_k: int) -> list[dict]:
        ...

    def count(self) -> int:
        ...


class HashEmbeddingModel:
    def __init__(self, dimensions: int = 384) -> None:
        self.dimensions = dimensions
        self.token_pattern = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]+")

    def normalize_token(self, token: str) -> str:
        token = token.lower().replace("-", "_")

        if len(token) > 5 and token.endswith("ies"):
            return f"{token[:-3]}y"
        if len(token) > 5 and token.endswith("ing"):
            return token[:-3]
        if len(token) > 4 and token.endswith("ed"):
            return token[:-2]
        if len(token) > 4 and token.endswith("s"):
            return token[:-1]

        return token

    def encode_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        tokens = [self.normalize_token(token) for token in self.token_pattern.findall(text)]

        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]

    def encode(self, texts: list[str]) -> list[list[float]]:
        return [self.encode_one(text) for text in texts]


def cosine_distance(left: list[float], right: list[float]) -> float:
    similarity = sum(a * b for a, b in zip(left, right))
    return 1.0 - similarity


class LocalJsonVectorBackend:
    name = "local-json"

    def __init__(self, path: Path) -> None:
        self.path = path
        self.embedding_model = HashEmbeddingModel()
        self._rows_cache: list[dict] | None = None

    def _read(self) -> list[dict]:
        if self._rows_cache is not None:
            return self._rows_cache
        if not self.path.exists():
            self._rows_cache = []
            return self._rows_cache
        with self.path.open("r", encoding="utf-8") as handle:
            self._rows_cache = json.load(handle)
        return self._rows_cache

    def _write(self, rows: list[dict]) -> None:
        self._rows_cache = rows
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(rows, handle, ensure_ascii=True, indent=2)

    def add_chunks(self, document_id: str, filename: str, chunks: list[TextChunk]) -> None:
        rows = self._read()
        embeddings = self.embedding_model.encode([chunk.text for chunk in chunks])

        for chunk, embedding in zip(chunks, embeddings):
            rows.append(
                {
                    "id": chunk.id,
                    "embedding": embedding,
                    "document": chunk.text,
                    "metadata": {
                        "document_id": document_id,
                        "source_document": filename,
                        "page_number": chunk.page_number,
                        "section_title": chunk.section_title or "",
                    },
                }
            )

        self._write(rows)

    def search(self, query: str, top_k: int) -> list[dict]:
        query_embedding = self.embedding_model.encode_one(query)
        rows = self._read()
        # Compute distances once, sort, slice — avoids double-computing per row
        scored = sorted(
            ((cosine_distance(query_embedding, row["embedding"]), row) for row in rows),
            key=lambda pair: pair[0],
        )
        return [
            {
                "chunk_id": row["id"],
                "text": row["document"],
                "metadata": row["metadata"],
                "distance": dist,
            }
            for dist, row in scored[:top_k]
        ]

    def count(self) -> int:
        return len(self._read())


class ChromaVectorBackend:
    name = "chroma"

    def __init__(self) -> None:
        import chromadb
        from chromadb import PersistentClient
        from sentence_transformers import SentenceTransformer

        settings = get_settings()
        self.client: PersistentClient = chromadb.PersistentClient(path=str(settings.chroma_dir))
        self.collection = self.client.get_or_create_collection(
            name=settings.chroma_collection,
            metadata={"hnsw:space": "cosine"},
        )
        self.embedding_model = SentenceTransformer(settings.embedding_model)

    def add_chunks(self, document_id: str, filename: str, chunks: list[TextChunk]) -> None:
        if not chunks:
            return

        embeddings = self.embedding_model.encode(
            [chunk.text for chunk in chunks],
            normalize_embeddings=True,
        ).tolist()

        self.collection.add(
            ids=[chunk.id for chunk in chunks],
            embeddings=embeddings,
            documents=[chunk.text for chunk in chunks],
            metadatas=[
                {
                    "document_id": document_id,
                    "source_document": filename,
                    "page_number": chunk.page_number,
                    "section_title": chunk.section_title or "",
                }
                for chunk in chunks
            ],
        )

    def search(self, query: str, top_k: int) -> list[dict]:
        query_embedding = self.embedding_model.encode(
            [query],
            normalize_embeddings=True,
        ).tolist()[0]

        result = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

        ids = result.get("ids", [[]])[0]
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

        return [
            {
                "chunk_id": ids[index],
                "text": documents[index],
                "metadata": metadatas[index],
                "distance": distances[index],
            }
            for index in range(len(ids))
        ]

    def count(self) -> int:
        return self.collection.count()


class VectorStore:
    def __init__(self) -> None:
        settings = get_settings()
        try:
            self.backend: VectorBackend = ChromaVectorBackend()
        except Exception:
            self.backend = LocalJsonVectorBackend(settings.vector_fallback_path)

    @property
    def backend_name(self) -> str:
        return self.backend.name

    def add_chunks(self, document_id: str, filename: str, chunks: list[TextChunk]) -> None:
        self.backend.add_chunks(document_id, filename, chunks)

    def search(self, query: str, top_k: int) -> list[dict]:
        return self.backend.search(query, top_k)

    def count(self) -> int:
        return self.backend.count()


@lru_cache
def get_vector_store() -> VectorStore:
    return VectorStore()
