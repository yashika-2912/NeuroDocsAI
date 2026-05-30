import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  BookOpen,
  Bot,
  BrainCircuit,
  ChevronDown,
  Copy,
  FileText,
  GitCompare,
  GitFork,
  GraduationCap,
  Loader2,
  MessageSquareText,
  MoreVertical,
  Network,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Sun,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import "./styles.css";
import AuthForm from "./AuthForm";
import { API_BASE } from "./api";
import { RenderErrorBoundary, ResponseRenderer } from "./ResponseRenderer";

const QUICK_PROMPTS = {
  Summarize: "Summarize the uploaded documents with citations.",
  "Generate Quiz": "Generate five quiz questions from the retrieved document context.",
  "Create Flashcards": "Create flashcards from the most important concepts.",
  "Compare Docs": "Compare the uploaded documents and show key differences.",
  "Mind Map": "Create a mind map from the uploaded document context.",
  "Show Table": "Show a table comparing the main documents or concepts.",
  "Research Summary": "Generate a research summary from the uploaded documents.",
};

const TONES = ["red", "blue", "green", "violet", "amber"];

function formatBytes(bytes = 0) {
  if (!bytes) return "PDF";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentTone(index) {
  return TONES[index % TONES.length];
}

function quickIcon(label) {
  const props = { size: 17 };
  const icons = {
    Summarize: <MessageSquareText {...props} />,
    "Generate Quiz": <GraduationCap {...props} />,
    "Create Flashcards": <BrainCircuit {...props} />,
    "Compare Docs": <GitCompare {...props} />,
    "Mind Map": <Network {...props} />,
    "Show Table": <GitFork {...props} />,
    "Research Summary": <Bot {...props} />,
  };
  return icons[label] ?? <Sparkles {...props} />;
}

function App() {
  const [authMode, setAuthMode] = useState("login");
  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rightTab, setRightTab] = useState("Sources");
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  const latestCitations = useMemo(() => {
    const message = [...messages].reverse().find((item) => item.citations?.length);
    return message?.citations ?? [];
  }, [messages]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((document) => document.filename.toLowerCase().includes(query));
  }, [documents, searchQuery]);

  useEffect(() => {
    if (!user) return;
    loadDocuments();
    loadSessions();
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  async function loadDocuments() {
    try {
      const response = await fetch(`${API_BASE}/api/documents`);
      if (response.ok) setDocuments(await response.json());
    } catch {
      setDocuments([]);
    }
  }

  async function loadSessions() {
    try {
      const response = await fetch(`${API_BASE}/api/chat/sessions`);
      if (response.ok) setSessions(await response.json());
    } catch {
      setSessions([]);
    }
  }

  async function uploadFiles(files) {
    const pdfs = Array.from(files ?? []).filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    if (!pdfs.length) return;

    const formData = new FormData();
    pdfs.forEach((file) => formData.append("files", file));
    setUploading(true);
    try {
      const response = await fetch(`${API_BASE}/api/documents/upload`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      await loadDocuments();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage(messageText = input) {
    const prompt = messageText.trim();
    if (!prompt || isStreaming) return;

    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        created_at: new Date().toISOString(),
        response_type: "text",
        citations: [],
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
        response_type: "text",
        citations: [],
        metadata: {},
      },
    ]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, session_id: activeSessionId, top_k: 5 }),
      });
      if (!response.ok || !response.body) throw new Error("Unable to stream chat response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        blocks.forEach((block) => processSseBlock(block, assistantId));
      }
      if (buffer) processSseBlock(buffer, assistantId);
      await loadSessions();
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: `I could not reach the chat service. ${error.message}` }
            : message,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function updateAssistantMessage(assistantId, updater) {
    setMessages((current) =>
      current.map((message) => (message.id === assistantId ? updater(message) : message)),
    );
  }

  function processSseBlock(block, assistantId) {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.replace("event:", "").trim();
    const dataLine = lines.find((line) => line.startsWith("data:"))?.replace("data:", "").trim();
    if (!event || !dataLine) return;

    const data = JSON.parse(dataLine);
    if (event === "session") {
      setActiveSessionId(data.session_id);
      return;
    }
    if (event === "response_type") {
      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        response_type: data.type ?? "text",
        metadata: data.metadata ?? {},
      }));
      return;
    }
    if (event === "citations") {
      updateAssistantMessage(assistantId, (message) => ({ ...message, citations: data }));
      return;
    }
    if (event === "delta") {
      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        content: `${message.content}${data.text}`,
      }));
      return;
    }
    if (event === "done" && data.response) {
      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        response_type: data.response.type ?? message.response_type,
        metadata: data.response.metadata ?? message.metadata ?? {},
        citations: data.response.citations ?? message.citations ?? [],
      }));
      return;
    }
    if (event === "error") {
      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        response_type: "text",
        content: `Error: ${data.detail ?? "Something went wrong."}`,
      }));
    }
  }

  if (!user) {
    return (
      <AuthForm
        mode={authMode}
        onSuccess={setUser}
        onSwitch={() => setAuthMode((mode) => (mode === "login" ? "register" : "login"))}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar user={user} onLogout={() => setUser(null)} searchQuery={searchQuery} onSearch={setSearchQuery} />
      <div className="workspace">
        <aside className="left-sidebar">
          <button
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
            {uploading ? "Indexing..." : "Upload Documents"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(event) => uploadFiles(event.target.files)}
          />

          <section className="sidebar-section">
            <h2>Your Documents</h2>
            {documents.length === 0 && <p className="empty-hint">Upload a PDF to get started.</p>}
            {documents.length > 0 && filteredDocuments.length === 0 && (
              <p className="empty-hint">No documents match your search.</p>
            )}
            {filteredDocuments.length > 0 && (
              <div className="doc-list">
                {filteredDocuments.map((document, index) => (
                  <DocumentItem key={document.id ?? document.filename} doc={document} tone={documentTone(index)} />
                ))}
              </div>
            )}
          </section>

          <section className="sidebar-section history-section">
            <h2>Chat History</h2>
            {sessions.length === 0 ? (
              <p className="empty-hint">No sessions yet.</p>
            ) : (
              <div className="history-list">
                {sessions.slice(0, 8).map((session) => (
                  <button
                    key={session.id}
                    className={`history-item ${session.id === activeSessionId ? "active" : ""}`}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    <span>{session.title}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <main className="chat-column">
          {messages.length === 0 && (
            <div className="hero-copy">
              <h1>How can I help you today?</h1>
              <p>Ask questions about your documents, generate summaries, or explore concepts.</p>
            </div>
          )}

          <div className="message-stream" ref={scrollRef} aria-live="polite">
            {messages.map((message) => (
              <ChatMessageView key={message.id} message={message} />
            ))}
            {isStreaming && (
              <div className="typing-row">
                <Sparkles size={16} />
                <span>NeuroDocs is reading your sources...</span>
              </div>
            )}
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask a question about your documents... (Shift+Enter for new line)"
              rows={2}
            />
            <div className="composer-actions">
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Paperclip size={17} /> Attach
              </button>
              <button
                className="send-button"
                type="button"
                onClick={() => sendMessage()}
                disabled={isStreaming || !input.trim()}
                aria-label="Send message"
              >
                {isStreaming ? <Loader2 className="spin" size={19} /> : <Send size={19} />}
              </button>
            </div>
          </div>
        </main>

        <aside className="right-panel">
          <section className="insight-card sources-card">
            <div className="tabs" role="tablist" aria-label="Panel tabs">
              {["Sources", "Quick Actions"].map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={rightTab === tab}
                  className={rightTab === tab ? "active" : ""}
                  onClick={() => setRightTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="panel-body" role="tabpanel">
              {rightTab === "Sources" && (
                <>
                  <h3>Top Sources</h3>
                  {latestCitations.length === 0 ? (
                    <p className="empty-hint">Sources will appear here after a response.</p>
                  ) : (
                    <div className="source-list">
                      {latestCitations.slice(0, 5).map((source, index) => (
                        <SourceItem
                          key={`${source.label}-${index}`}
                          source={source}
                          tone={documentTone(index)}
                          score={92 - index * 9}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              {rightTab === "Quick Actions" && (
                <>
                  <h3>Quick Actions</h3>
                  <div className="quick-grid">
                    {Object.entries(QUICK_PROMPTS).map(([label, prompt], index) => (
                      <button
                        key={label}
                        className={`quick-action tone-${documentTone(index + 2)}`}
                        onClick={() => sendMessage(prompt)}
                        disabled={isStreaming}
                      >
                        {quickIcon(label)}
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function TopBar({ user, onLogout, searchQuery, onSearch }) {
  const [darkMode, setDarkMode] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notifRef = useRef(null);
  const userMenuRef = useRef(null);
  const searchRef = useRef(null);
  const userInitial = user?.email?.[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    document.body.classList.toggle("dark-mode", darkMode);
  }, [darkMode]);

  useEffect(() => {
    function handleClick(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <BookOpen size={28} />
        </div>
        <div>
          <strong>NeuroDocs AI</strong>
          <span>Intelligent Document Assistant</span>
        </div>
      </div>

      <div className="global-search" role="search">
        <Search size={20} />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search your documents..."
          aria-label="Search documents"
          value={searchQuery}
          onChange={(event) => onSearch(event.target.value)}
        />
        <kbd aria-label="Keyboard shortcut Command K">Ctrl K</kbd>
      </div>

      <div className="top-actions">
        <button
          className={`icon-button theme-toggle ${darkMode ? "active" : ""}`}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setDarkMode((value) => !value)}
        >
          <Sun size={20} />
        </button>

        <div className="topbar-dropdown-wrap" ref={notifRef}>
          <button
            className="icon-button notif-btn"
            aria-label="Notifications"
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen((value) => !value)}
          >
            <Bell size={20} />
            <span className="notif-dot" aria-hidden="true" />
          </button>
          {notifOpen && (
            <div className="topbar-dropdown notif-dropdown" role="dialog" aria-label="Notifications">
              <div className="dropdown-header">
                <span>Notifications</span>
                <button className="dropdown-clear" onClick={() => setNotifOpen(false)}>
                  Mark all read
                </button>
              </div>
              <div className="notif-item unread">
                <div className="notif-icon tone-violet">
                  <Sparkles size={15} />
                </div>
                <div>
                  <strong>Document indexed</strong>
                  <span>Your PDF is ready to query</span>
                </div>
              </div>
              <div className="notif-empty-hint">You're all caught up</div>
            </div>
          )}
        </div>

        <div className="topbar-dropdown-wrap" ref={userMenuRef}>
          <button
            className="avatar-btn"
            onClick={() => setUserMenuOpen((value) => !value)}
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            title={user?.email}
          >
            <div className="avatar">{userInitial}</div>
          </button>
          {userMenuOpen && (
            <div className="topbar-dropdown user-dropdown" role="dialog" aria-label="User menu">
              <div className="user-dropdown-profile">
                <div className="avatar avatar-lg">{userInitial}</div>
                <div>
                  <strong>{user?.email}</strong>
                  <span>Free plan</span>
                </div>
              </div>
              <button
                className="dropdown-item danger"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout();
                }}
              >
                <ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function DocumentItem({ doc, tone }) {
  return (
    <div className="doc-item">
      <div className={`doc-icon tone-${tone}`}>
        <FileText size={19} />
      </div>
      <div className="doc-meta">
        <strong title={doc.filename}>{doc.filename}</strong>
        <span>
          PDF - {formatBytes(doc.size_bytes)}
          {doc.page_count ? ` - ${doc.page_count} pages` : ""}
        </span>
      </div>
      <button className="icon-button compact" aria-label={`Options for ${doc.filename}`}>
        <MoreVertical size={17} />
      </button>
    </div>
  );
}

function ChatMessageView({ message }) {
  const isUser = message.role === "user";
  const [feedback, setFeedback] = useState(null);

  return (
    <article className={`message-row ${isUser ? "user-row" : "assistant-row"}`}>
      {!isUser && (
        <div className="assistant-badge">
          <Sparkles size={18} />
        </div>
      )}
      <div className={`message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
        {message.content ? (
          <RenderErrorBoundary fallback={message.content}>
            <ResponseRenderer message={message} />
          </RenderErrorBoundary>
        ) : (
          <div className="message-skeleton" aria-label="Loading response">
            <span />
            <span />
            <span />
          </div>
        )}
        {!isUser && message.content && (
          <footer className="message-footer">
            {message.citations?.length > 0 && <span>Sources: {message.citations.length}</span>}
            <button
              aria-label="Mark as helpful"
              className={feedback === "up" ? "active-feedback" : ""}
              onClick={() => setFeedback(feedback === "up" ? null : "up")}
            >
              <ThumbsUp size={15} />
            </button>
            <button
              aria-label="Mark as not helpful"
              className={feedback === "down" ? "active-feedback" : ""}
              onClick={() => setFeedback(feedback === "down" ? null : "down")}
            >
              <ThumbsDown size={15} />
            </button>
            <button className="copy-button" onClick={() => navigator.clipboard?.writeText(message.content)}>
              <Copy size={15} /> Copy
            </button>
          </footer>
        )}
      </div>
      {isUser && <div className="user-badge">U</div>}
    </article>
  );
}

function SourceItem({ source, tone, score }) {
  return (
    <div className="source-item">
      <div className={`doc-icon tone-${tone}`}>
        <FileText size={18} />
      </div>
      <div>
        <strong>{source.source_document ?? source.label?.split(" (")[0]}</strong>
        <span>Page {source.page_number ?? "-"}</span>
      </div>
      <em aria-label={`Relevance score ${score}%`}>{score}%</em>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
