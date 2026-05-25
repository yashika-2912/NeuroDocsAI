# NeuroDocs AI

Phase 1 backend foundation for an intelligent multi-PDF RAG platform.

## What is included

- FastAPI backend
- Multi-PDF upload endpoint
- PDF text extraction with PyMuPDF
- Clean text preprocessing
- Overlapping chunking pipeline
- Sentence Transformer embeddings
- ChromaDB persistent vector storage
- Document metadata and source tracing
- Basic semantic search endpoint

## Quick Start

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Start the React frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

For production-grade semantic embeddings and ChromaDB storage, install the optional AI stack:

```powershell
pip install -r requirements-ai.txt
```

If those packages are unavailable, the backend automatically uses a persistent local cosine-vector fallback so upload/search development can continue.

To enable GPT responses, set an OpenAI API key before starting the server:

```powershell
$env:OPENAI_API_KEY="your_api_key"
$env:OPENAI_MODEL="gpt-5"
uvicorn app.main:app --reload
```

Without `OPENAI_API_KEY`, chat endpoints still work using a grounded retrieval fallback.

API docs will be available at:

```text
http://127.0.0.1:8000/docs
```

Frontend app:

```text
http://127.0.0.1:5173
```

## Endpoints

- `GET /health` - service health and storage counts
- `POST /api/documents/upload` - upload one or more PDF files
- `GET /api/documents` - list uploaded documents
- `POST /api/retrieve` - top-k semantic retrieval with structured citations
- `POST /api/search` - compatibility alias for retrieval
- `POST /api/chat` - conversational RAG response with memory and citations
- `POST /api/chat/stream` - streaming conversational RAG response using server-sent events
- `GET /api/chat/sessions` - list chat sessions
- `GET /api/chat/sessions/{session_id}` - inspect a chat session and memory

Example retrieval request:

```json
{
  "query": "How does citation grounding work?",
  "top_k": 5
}
```

## Storage

Runtime data is stored under `storage/`:

- `storage/uploads/` - uploaded PDFs
- `storage/chroma/` - ChromaDB vector database when optional AI dependencies are installed
- `storage/vector_fallback.json` - local vector fallback for development
- `storage/documents.json` - document metadata index
- `storage/chat_sessions.json` - persisted chat session memory
