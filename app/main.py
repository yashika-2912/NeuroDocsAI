import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.models import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatSession,
    DocumentRecord,
    HealthResponse,
    SearchRequest,
    SearchResponse,
    UploadedDocumentResult,
    UploadResponse,
)
from app.services.chat_store import ChatSessionStore
from app.services.chunker import chunk_pages
from app.services.document_store import DocumentStore
from app.services.llm import OpenAIChatService
from app.services.pdf_extractor import extract_pdf_text
from app.services.retrieval import retrieve_relevant_chunks
from app.services.vector_store import get_vector_store
from app.auth import router as auth_router

settings = get_settings()
document_store = DocumentStore(settings.documents_index_path)
chat_store = ChatSessionStore(settings.chat_sessions_path)

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth")

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    vector_store = get_vector_store()
    return HealthResponse(
        status="ok",
        document_count=len(document_store.list_documents()),
        chunk_count=vector_store.count(),
        vector_backend=vector_store.backend_name,
    )


@app.get("/api/documents", response_model=list[DocumentRecord])
def list_documents() -> list[DocumentRecord]:
    return document_store.list_documents()


@app.post("/api/documents/upload", response_model=UploadResponse)
async def upload_documents(files: list[UploadFile] = File(...)) -> UploadResponse:
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one PDF file.")

    results: list[UploadedDocumentResult] = []
    vector_store = get_vector_store()

    for file in files:
        if file.content_type not in {"application/pdf", "application/octet-stream"}:
            raise HTTPException(status_code=400, detail=f"{file.filename} is not a PDF.")

        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail=f"{file.filename} is empty.")

        max_bytes = settings.max_upload_mb * 1024 * 1024
        if len(raw) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"{file.filename} exceeds the {settings.max_upload_mb} MB limit.",
            )

        document_id = str(uuid4())
        stored_filename = f"{document_id}.pdf"
        stored_path = settings.uploads_dir / stored_filename
        stored_path.write_bytes(raw)

        pages = extract_pdf_text(stored_path)
        chunks = chunk_pages(
            pages=pages,
            document_id=document_id,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )

        if not chunks:
            stored_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=422,
                detail=f"No extractable text found in {file.filename}. OCR is not enabled yet.",
            )

        vector_store.add_chunks(document_id=document_id, filename=file.filename or stored_filename, chunks=chunks)

        record = DocumentRecord(
            id=document_id,
            filename=file.filename or stored_filename,
            stored_filename=stored_filename,
            content_type=file.content_type or "application/pdf",
            size_bytes=len(raw),
            page_count=len(pages),
            chunk_count=len(chunks),
            uploaded_at=datetime.now(timezone.utc),
        )
        document_store.add_document(record)
        results.append(UploadedDocumentResult(document=record))

    return UploadResponse(documents=results)


@app.post("/api/retrieve", response_model=SearchResponse)
def retrieve(request: SearchRequest) -> SearchResponse:
    results = retrieve_relevant_chunks(query=request.query, top_k=request.top_k)

    return SearchResponse(
        query=request.query,
        top_k=request.top_k,
        results=results,
        citations=[result.citation for result in results],
    )


@app.post("/api/search", response_model=SearchResponse)
def semantic_search(request: SearchRequest) -> SearchResponse:
    return retrieve(request)


@app.get("/api/chat/sessions", response_model=list[ChatSession])
def list_chat_sessions() -> list[ChatSession]:
    return chat_store.list_sessions()


@app.get("/api/chat/sessions/{session_id}", response_model=ChatSession)
def get_chat_session(session_id: str) -> ChatSession:
    session = chat_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    return session


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    session = chat_store.get_or_create_session(request.session_id, request.message)
    history = session.messages.copy()
    chat_store.append_message(session.id, ChatMessage(role="user", content=request.message))

    retrieved_chunks = retrieve_relevant_chunks(query=request.message, top_k=request.top_k)
    llm = OpenAIChatService()
    result = llm.complete(request.message, history, retrieved_chunks)
    citations = [chunk.citation for chunk in retrieved_chunks]
    assistant_message = chat_store.append_message(
        session.id,
        ChatMessage(role="assistant", content=result.text, citations=citations),
    )

    return ChatResponse(
        session_id=session.id,
        message_id=assistant_message.id,
        answer=result.text,
        citations=citations,
        retrieved_chunks=retrieved_chunks,
        model=result.model,
        used_fallback=result.used_fallback,
    )


@app.post("/api/chat/stream")
def stream_chat(request: ChatRequest) -> StreamingResponse:
    def events():
        session = chat_store.get_or_create_session(request.session_id, request.message)
        history = session.messages.copy()
        chat_store.append_message(session.id, ChatMessage(role="user", content=request.message))

        retrieved_chunks = retrieve_relevant_chunks(query=request.message, top_k=request.top_k)
        citations = [chunk.citation for chunk in retrieved_chunks]
        llm = OpenAIChatService()
        assistant_parts: list[str] = []

        yield f"event: session\ndata: {json.dumps({'session_id': session.id})}\n\n"
        yield (
            "event: citations\n"
            f"data: {json.dumps([citation.model_dump(mode='json') for citation in citations])}\n\n"
        )

        try:
            for delta in llm.stream(request.message, history, retrieved_chunks):
                assistant_parts.append(delta)
                yield f"event: delta\ndata: {json.dumps({'text': delta})}\n\n"

            assistant_text = "".join(assistant_parts)
            assistant_message = chat_store.append_message(
                session.id,
                ChatMessage(role="assistant", content=assistant_text, citations=citations),
            )
            done = {
                "session_id": session.id,
                "message_id": assistant_message.id,
                "model": llm.model,
                "used_fallback": llm.client is None,
            }
            yield f"event: done\ndata: {json.dumps(done)}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
