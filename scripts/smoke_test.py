from pathlib import Path
import sys

from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.main import app


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

    search = client.post("/api/search", json={"query": "semantic search embeddings", "top_k": 2})
    assert search.status_code == 200, search.text
    assert search.json()["top_k"] == 2

    chat = client.post("/api/chat", json={"message": "Explain citation grounding.", "top_k": 2})
    assert chat.status_code == 200, chat.text
    chat_body = chat.json()
    assert chat_body["session_id"], chat_body
    assert chat_body["answer"], chat_body
    assert chat_body["citations"], chat_body

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

    stream = client.post("/api/chat/stream", json={"message": "Stream a short answer.", "top_k": 1})
    assert stream.status_code == 200, stream.text
    assert "event: delta" in stream.text
    assert "event: done" in stream.text

    print("Smoke test passed.")
    print(f"Indexed document: {uploaded['documents'][0]['document']['filename']}")
    print(f"Top retrieval hit: {body['results'][0]['citation']['label']}")
    print(f"Chat session: {chat_body['session_id']}")


if __name__ == "__main__":
    main()
