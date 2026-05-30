from pathlib import Path
import sys

from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.main import app
from app.models import Citation, SearchResult
from app.services.retrieval import diversify_results


def create_sample_pdf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(path), pagesize=letter)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(72, 740, "Neural Retrieval Systems")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(72, 710, "Retrieval augmented generation combines semantic search with language models.")
    pdf.drawString(72, 690, "Embeddings help find relevant PDF chunks using meaning rather than exact keywords.")
    pdf.showPage()
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(72, 740, "Citation Grounding")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(72, 710, "Source tracing shows the document name and page number for each retrieved chunk.")
    pdf.save()


def result_for(text: str, document_id: str = "doc-1", rank: int = 1) -> SearchResult:
    return SearchResult(
        rank=rank,
        chunk_id=f"{document_id}-{rank}",
        text=text,
        citation=Citation(
            document_id=document_id,
            source_document=f"{document_id}.pdf",
            page_number=rank,
            section_title=None,
            chunk_id=f"{document_id}-{rank}",
            label=f"{document_id}.pdf (p. {rank})",
        ),
        distance=0.1,
        score=0.9,
    )


def main() -> None:
    sample_path = Path("storage/test-fixtures/sample.pdf")
    create_sample_pdf(sample_path)

    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200, health.text

    with sample_path.open("rb") as handle:
        upload = client.post(
            "/api/documents/upload",
            files=[("files", ("sample.pdf", handle, "application/pdf"))],
        )
    assert upload.status_code == 200, upload.text
    uploaded = upload.json()
    assert uploaded["documents"][0]["document"]["chunk_count"] >= 1

    retrieval = client.post("/api/retrieve", json={"query": "How are citations traced?", "top_k": 3})
    assert retrieval.status_code == 200, retrieval.text
    body = retrieval.json()
    assert body["results"], body
    assert body["top_k"] == 3
    assert len(body["results"]) <= 3
    assert body["citations"], body
    assert body["results"][0]["rank"] == 1
    assert body["results"][0]["citation"]["source_document"] == "sample.pdf"
    assert body["results"][0]["citation"]["page_number"] >= 1
    assert "sample.pdf" in body["results"][0]["citation"]["label"]

    diversified = diversify_results(
        [
            result_for("Semantic search retrieves relevant chunks using embeddings.", rank=1),
            result_for("Semantic search retrieves relevant chunk using embedding.", rank=2),
            result_for("Citation grounding connects answers to document pages.", "doc-2", rank=1),
        ],
        top_k=2,
    )
    assert len(diversified) == 2
    assert len({result.chunk_id for result in diversified}) == 2
    assert diversified[0].chunk_id != diversified[1].chunk_id

    search = client.post("/api/search", json={"query": "semantic search embeddings", "top_k": 2})
    assert search.status_code == 200, search.text
    assert search.json()["top_k"] == 2

    chat = client.post("/api/chat", json={"message": "Explain citation grounding.", "top_k": 2})
    assert chat.status_code == 200, chat.text
    chat_body = chat.json()
    assert chat_body["session_id"], chat_body
    assert chat_body["answer"], chat_body
    assert chat_body["citations"], chat_body
    assert chat_body["response"]["type"] in {"text", "summary", "table", "mermaid", "quiz"}

    follow_up = client.post(
        "/api/chat",
        json={
            "session_id": chat_body["session_id"],
            "message": "What did I just ask about?",
            "top_k": 2,
        },
    )
    assert follow_up.status_code == 200, follow_up.text
    assert follow_up.json()["session_id"] == chat_body["session_id"]

    table = client.post("/api/chat", json={"message": "Compare citation grounding concepts in a table.", "top_k": 2})
    assert table.status_code == 200, table.text
    assert table.json()["response"]["type"] == "table"
    assert "| Concept |" in table.json()["response"]["content"]
    assert "| Source |" not in table.json()["response"]["content"]

    diagram = client.post("/api/chat", json={"message": "Create a mind map.", "top_k": 2})
    assert diagram.status_code == 200, diagram.text
    assert diagram.json()["response"]["type"] == "mermaid"
    assert "```mermaid" in diagram.json()["response"]["content"]

    quiz = client.post("/api/chat", json={"message": "Generate a quiz about citation grounding.", "top_k": 2})
    assert quiz.status_code == 200, quiz.text
    assert quiz.json()["response"]["type"] == "quiz"
    assert "Correct Answer" in quiz.json()["response"]["content"]
    assert "Which source" not in quiz.json()["response"]["content"]

    flashcards = client.post("/api/chat", json={"message": "Create flashcards about citation grounding.", "top_k": 2})
    assert flashcards.status_code == 200, flashcards.text
    assert flashcards.json()["response"]["type"] == "quiz"
    assert "Flashcards" in flashcards.json()["response"]["content"]

    stream = client.post("/api/chat/stream", json={"message": "Stream a short answer.", "top_k": 1})
    assert stream.status_code == 200, stream.text
    assert "event: response_type" in stream.text
    assert "event: delta" in stream.text
    assert "event: done" in stream.text

    print("Smoke test passed.")
    print(f"Indexed document: {uploaded['documents'][0]['document']['filename']}")
    print(f"Top retrieval hit: {body['results'][0]['citation']['label']}")
    print(f"Chat session: {chat_body['session_id']}")


if __name__ == "__main__":
    main()
