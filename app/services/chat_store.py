import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.models import ChatMessage, ChatSession


class ChatSessionStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def _read(self) -> list[ChatSession]:
        if not self.path.exists():
            return []

        with self.path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)

        return [ChatSession.model_validate(item) for item in raw]

    def _write(self, sessions: list[ChatSession]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(
                [session.model_dump(mode="json") for session in sessions],
                handle,
                ensure_ascii=True,
                indent=2,
            )

    def list_sessions(self) -> list[ChatSession]:
        return sorted(self._read(), key=lambda session: session.updated_at, reverse=True)

    def get_session(self, session_id: str) -> ChatSession | None:
        for session in self._read():
            if session.id == session_id:
                return session
        return None

    def get_or_create_session(self, session_id: str | None, first_message: str) -> ChatSession:
        sessions = self._read()

        if session_id:
            for session in sessions:
                if session.id == session_id:
                    return session

        now = datetime.utcnow()
        title = first_message.strip().splitlines()[0][:60] or "New chat"
        session = ChatSession(id=str(uuid4()), title=title, created_at=now, updated_at=now)
        sessions.append(session)
        self._write(sessions)
        return session

    def append_message(self, session_id: str, message: ChatMessage) -> ChatMessage:
        sessions = self._read()

        for session in sessions:
            if session.id == session_id:
                session.messages.append(message)
                session.updated_at = datetime.utcnow()
                self._write(sessions)
                return message

        raise ValueError(f"Chat session not found: {session_id}")
