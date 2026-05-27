from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class DocumentRecord(BaseModel):
    id: str
    filename: str
    stored_filename: str
    content_type: str
    size_bytes: int
    page_count: int
    chunk_count: int
    uploaded_at: datetime


class UploadedDocumentResult(BaseModel):
    document: DocumentRecord
    status: Literal["indexed"] = "indexed"


class UploadResponse(BaseModel):
    documents: list[UploadedDocumentResult]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=25)


class Citation(BaseModel):
    document_id: str
    source_document: str
    page_number: int
    section_title: str | None
    chunk_id: str
    label: str


class SearchResult(BaseModel):
    rank: int
    chunk_id: str
    text: str
    citation: Citation
    distance: float | None = None
    score: float | None = None


class SearchResponse(BaseModel):
    query: str
    top_k: int
    results: list[SearchResult]
    citations: list[Citation]


class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    citations: list[Citation] = Field(default_factory=list)
    response_type: Literal["text", "table", "mermaid", "quiz", "summary"] = "text"
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatSession(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None
    top_k: int = Field(default=5, ge=1, le=25)


class ChatResponse(BaseModel):
    session_id: str
    message_id: str
    answer: str
    citations: list[Citation]
    retrieved_chunks: list[SearchResult]
    model: str
    used_fallback: bool
    response: "StructuredResponse"


class StructuredResponse(BaseModel):
    type: Literal["text", "table", "mermaid", "quiz", "summary"]
    content: str
    citations: list[Citation] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    document_count: int
    chunk_count: int
    vector_backend: str
