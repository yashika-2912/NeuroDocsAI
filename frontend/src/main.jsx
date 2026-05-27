import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "./mermaid-init";
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
  Maximize2,
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
  Zap,
} from "lucide-react";
import "./styles.css";
import AuthForm from "./AuthForm";
import { API_BASE } from "./api";

// ---------------------------------------------------------------------------
// Quick-action prompts
// ---------------------------------------------------------------------------
const QUICK_PROMPTS = {
  Summarize: "Summarize the uploaded documents with citations.",
  "Generate Quiz": "Generate five quiz questions from the retrieved document context.",
  "Create Flashcards": "Create flashcards from the most important concepts.",
  "Compare Docs": "Compare the uploaded documents and show key differences.",
  "Mind Map": "Create a Mermaid diagram summarizing the main concepts.",
  "Show Table": "Show a table comparing the main documents or concepts.",
  "Research Summary": "Generate a research summary from the uploaded documents.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes = 0) {
  if (!bytes) return "PDF";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TONES = ["red", "blue", "green", "violet", "amber"];
function documentTone(index) {
  return TONES[index % TONES.length];
}

function quickIcon(label) {
  const props = { size: 17 };
  const map = {
    Summarize: <MessageSquareText {...props} />,
    "Generate Quiz": <GraduationCap {...props} />,
    "Create Flashcards": <BrainCircuit {...props} />,
    "Compare Docs": <GitCompare {...props} />,
    "Mind Map": <Network {...props} />,
    "Show Table": <GitFork {...props} />,
    "Research Summary": <Bot {...props} />,
  };
  return map[label] ?? <Sparkles {...props} />;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
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
    const msg = [...messages].reverse().find((m) => m.citations?.length);
    return msg?.citations ?? [];
  }, [messages]);
  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => doc.filename.toLowerCase().includes(query));
  }, [documents, searchQuery]);

  useEffect(() => {
    if (user) {
      loadDocuments();
      loadSessions();
    }
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  async function loadDocuments() {
    try {
      const res = await fetch(`${API_BASE}/api/documents`);
      if (res.ok) setDocuments(await res.json());
    } catch {
      setDocuments([]);
    }
  }

  async function loadSessions() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`);
      if (res.ok) setSessions(await res.json());
    } catch {
      setSessions([]);
    }
  }

  async function uploadFiles(files) {
    const pdfs = Array.from(files ?? []).filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    if (!pdfs.length) return;
    const formData = new FormData();
    pdfs.forEach((f) => formData.append("files", f));
    setUploading(true);
    try {
      const res = await fetch(`${API_BASE}/api/documents/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      await loadDocuments();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage(messageText = input) {
    const prompt = messageText.trim();
    if (!prompt || isStreaming) return;

    const userMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      created_at: new Date().toISOString(),
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString(), citations: [] },
    ]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, session_id: activeSessionId, top_k: 5 }),
      });
      if (!res.ok || !res.body) throw new Error("Unable to stream chat response.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) processSseBlock(block, assistantId);
      }
      if (buffer) processSseBlock(buffer, assistantId);
      await loadSessions();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `I could not reach the chat service. ${err.message}` }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function processSseBlock(block, assistantId) {
    const lines = block.split("\n");
    const event = lines.find((l) => l.startsWith("event:"))?.replace("event:", "").trim();
    const dataLine = lines.find((l) => l.startsWith("data:"))?.replace("data:", "").trim();
    if (!event || !dataLine) return;
    const data = JSON.parse(dataLine);
    if (event === "session") setActiveSessionId(data.session_id);
    if (event === "citations") {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, citations: data } : m))
      );
    }
    if (event === "response_type") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, response_type: data.type ?? "text", metadata: data.metadata ?? {} }
            : m
        )
      );
    }
    if (event === "delta") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `${m.content}${data.text}` } : m
        )
      );
    }
    if (event === "error") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${data.detail ?? "Something went wrong."}` }
            : m
        )
      );
    }
    if (event === "done" && data.response) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                response_type: data.response.type ?? m.response_type ?? "text",
                metadata: data.response.metadata ?? m.metadata ?? {},
                citations: data.response.citations ?? m.citations ?? [],
              }
            : m
        )
      );
    }
  }

  if (!user) {
    return (
      <AuthForm
        mode={authMode}
        onSuccess={setUser}
        onSwitch={() => setAuthMode((m) => (m === "login" ? "register" : "login"))}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar user={user} onLogout={() => setUser(null)} searchQuery={searchQuery} onSearch={setSearchQuery} />
      <div className="workspace">
        {/* Left sidebar */}
        <aside className="left-sidebar">
          <button
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label={uploading ? "Indexing documents" : "Upload documents"}
          >
            {uploading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            {uploading ? "Indexing..." : "Upload Documents"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            aria-hidden="true"
            onChange={(e) => uploadFiles(e.target.files)}
          />

          <section className="sidebar-section">
            <h2>Your Documents</h2>
            {documents.length === 0 ? (
              <p className="empty-hint">Upload a PDF to get started.</p>
            ) : filteredDocuments.length === 0 ? (
              <p className="empty-hint">No documents match your search.</p>
            ) : (
              <div className="doc-list">
                {filteredDocuments.map((doc, i) => (
                  <DocumentItem key={doc.id ?? doc.filename} doc={doc} tone={documentTone(i)} />
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

        {/* Chat column */}
        <main className="chat-column">
          {messages.length === 0 && (
            <div className="hero-copy">
              <h1>How can I help you today?</h1>
              <p>Ask questions about your documents, generate summaries, or explore concepts.</p>
            </div>
          )}

          <div className="message-stream" ref={scrollRef} aria-live="polite" aria-label="Chat messages">
            {messages.map((msg) => (
              <ChatMessageView key={msg.id} message={msg} />
            ))}
            {isStreaming && (
              <div className="typing-row" aria-live="polite">
                <Sparkles size={16} aria-hidden="true" />
                <span>NeuroDocs is reading your sources...</span>
              </div>
            )}
          </div>

          <div className="composer">
            <label htmlFor="chat-input" className="sr-only">
              Ask a question
            </label>
            <textarea
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask a question about your documents… (Shift+Enter for new line)"
              rows={2}
            />
            <div className="composer-actions">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach PDF"
              >
                <Paperclip size={17} aria-hidden="true" /> Attach
              </button>
              <button
                className="send-button"
                type="button"
                onClick={() => sendMessage()}
                disabled={isStreaming || !input.trim()}
                aria-label={isStreaming ? "Sending…" : "Send message"}
              >
                {isStreaming ? (
                  <Loader2 className="spin" size={19} aria-hidden="true" />
                ) : (
                  <Send size={19} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </main>

        {/* Right panel */}
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
                      {latestCitations.slice(0, 5).map((source, i) => (
                        <SourceItem
                          key={`${source.label}-${i}`}
                          source={source}
                          tone={documentTone(i)}
                          score={92 - i * 9}
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
                    {Object.entries(QUICK_PROMPTS).map(([label, prompt], i) => (
                      <button
                        key={label}
                        className={`quick-action tone-${documentTone(i + 2)}`}
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

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------
function TopBar({ user, onLogout, searchQuery, onSearch }) {
  const [darkMode, setDarkMode] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notifRef = useRef(null);
  const userMenuRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", darkMode);
  }, [darkMode]);

  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  useEffect(() => {
    function handleShortcut(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  const userInitial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <BookOpen size={28} />
        </div>
        <div>
          <strong>NeuroDocs AI</strong>
          <span>Intelligent Document Assistant</span>
        </div>
      </div>

      <div className="global-search" role="search">
        <Search size={20} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search your documents…"
          aria-label="Search documents"
          value={searchQuery}
          onChange={(event) => onSearch(event.target.value)}
        />
        <kbd aria-label="Keyboard shortcut Command K">⌘ K</kbd>
      </div>

      <div className="top-actions">
        <button
          className={`icon-button theme-toggle ${darkMode ? "active" : ""}`}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setDarkMode((v) => !v)}
        >
          <Sun size={20} aria-hidden="true" />
        </button>

        <div className="topbar-dropdown-wrap" ref={notifRef}>
          <button
            className="icon-button notif-btn"
            aria-label="Notifications"
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen((v) => !v)}
          >
            <Bell size={20} aria-hidden="true" />
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
                <div className="notif-icon tone-violet" aria-hidden="true">
                  <Sparkles size={15} />
                </div>
                <div>
                  <strong>Document indexed</strong>
                  <span>Your PDF is ready to query</span>
                </div>
              </div>
              <div className="notif-item">
                <div className="notif-icon tone-blue" aria-hidden="true">
                  <BookOpen size={15} />
                </div>
                <div>
                  <strong>New feature</strong>
                  <span>Mind maps now support export</span>
                </div>
              </div>
              <div className="notif-empty-hint">You're all caught up</div>
            </div>
          )}
        </div>

        <div className="topbar-dropdown-wrap" ref={userMenuRef}>
          <button
            className="avatar-btn"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            title={user?.email}
          >
            <div className="avatar" aria-hidden="true">
              {userInitial}
            </div>
          </button>
          {userMenuOpen && (
            <div className="topbar-dropdown user-dropdown" role="dialog" aria-label="User menu">
              <div className="user-dropdown-profile">
                <div className="avatar avatar-lg" aria-hidden="true">
                  {userInitial}
                </div>
                <div>
                  <strong>{user?.email}</strong>
                  <span>Free plan</span>
                </div>
              </div>
              <div className="dropdown-divider" />
              <button
                className="dropdown-item danger"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout();
                }}
              >
                <ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// DocumentItem
// ---------------------------------------------------------------------------
function DocumentItem({ doc, tone }) {
  return (
    <div className="doc-item">
      <div className={`doc-icon tone-${tone}`} aria-hidden="true">
        <FileText size={19} />
      </div>
      <div className="doc-meta">
        <strong title={doc.filename}>{doc.filename}</strong>
        <span>
          PDF · {formatBytes(doc.size_bytes)}
          {doc.page_count ? ` · ${doc.page_count} pages` : ""}
        </span>
      </div>
      <button className="icon-button compact" aria-label={`Options for ${doc.filename}`}>
        <MoreVertical size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatMessageView
// ---------------------------------------------------------------------------
class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="render-fallback">
          <p>This response could not be rendered safely. Showing plain text instead.</p>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{this.props.fallback ?? ""}</ReactMarkdown>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChatMessageView({ message }) {
  const isUser = message.role === "user";
  const [feedback, setFeedback] = useState(null);
  const [mermaidSvgs, setMermaidSvgs] = useState({});

  useEffect(() => {
    // Find all mermaid blocks in the content
    const matches = [...(message.content?.matchAll(/```mermaid\n([\s\S]*?)```/g) ?? [])];
    if (!matches.length) {
      setMermaidSvgs({});
      return;
    }
    matches.forEach((match, idx) => {
      const id = `mermaid-${message.id}-${idx}`;
      mermaid
        .render(id, match[1].trim())
        .then(({ svg }) => setMermaidSvgs((prev) => ({ ...prev, [idx]: svg })))
        .catch(() => { });
    });
  }, [message.content, message.id]);

  // Replace each ```mermaid...``` block with a placeholder token, then render
  const renderContent = () => {
    if (!message.content) return null;

    const parts = message.content.split(/(```mermaid\n[\s\S]*?```)/g);
    let diagramIdx = 0;

    return parts.map((part, i) => {
      if (part.startsWith("```mermaid")) {
        const svg = mermaidSvgs[diagramIdx];
        const idx = diagramIdx++;
        if (svg) {
          return (
            <div
              key={i}
              className="mermaid-output"
              dangerouslySetInnerHTML={{ __html: svg }}
              aria-label="Mermaid diagram"
            />
          );
        }
        // Still rendering — show a small placeholder
        return (
          <div key={i} className="mermaid-loading" aria-label="Rendering diagram">
            <Loader2 className="spin" size={16} aria-hidden="true" />
            <span>Rendering diagram…</span>
          </div>
        );
      }
      if (part.trim()) {
        return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>;
      }
      return null;
    });
  };

  return (
    <article
      className={`message-row ${isUser ? "user-row" : "assistant-row"}`}
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      {!isUser && (
        <div className="assistant-badge" aria-hidden="true">
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
            {message.citations?.length > 0 && (
              <span>Sources: {message.citations.length}</span>
            )}
            <button
              aria-label="Mark as helpful"
              className={feedback === "up" ? "active-feedback" : ""}
              onClick={() => setFeedback(feedback === "up" ? null : "up")}
            >
              <ThumbsUp size={15} aria-hidden="true" />
            </button>
            <button
              aria-label="Mark as not helpful"
              className={feedback === "down" ? "active-feedback" : ""}
              onClick={() => setFeedback(feedback === "down" ? null : "down")}
            >
              <ThumbsDown size={15} aria-hidden="true" />
            </button>
            <button
              className="copy-button"
              onClick={() => navigator.clipboard?.writeText(message.content)}
              aria-label="Copy response"
            >
              <Copy size={15} aria-hidden="true" /> Copy
            </button>
          </footer>
        )}
      </div>
      {isUser && (
        <div className="user-badge" aria-hidden="true">
          {/* filled by CSS / parent context — just a visual indicator */}
          U
        </div>
      )}
    </article>
  );
}

function inferResponseType(message) {
  if (message.response_type) return message.response_type;
  if (/```mermaid\s+[\s\S]*?```/i.test(message.content ?? "")) return "mermaid";
  if (/^\s*\|.+\|\s*$/m.test(message.content ?? "")) return "table";
  return "text";
}

function ResponseRenderer({ message }) {
  const type = inferResponseType(message);
  const content = message.content ?? "";

  if (type === "mermaid") return <MermaidResponse content={content} />;

  if (type === "table") {
    return (
      <div className="markdown-table-wrap">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  if (type === "quiz") {
    return (
      <div className="structured-response quiz-response">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  if (type === "summary") {
    return (
      <div className="structured-response summary-response">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}

function MermaidResponse({ content }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  const code = match?.[1]?.trim() ?? "";

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      if (!code) {
        setError("No Mermaid diagram was returned.");
        return;
      }
      try {
        await mermaid.parse(code);
        const result = await mermaid.render(`mermaid-${crypto.randomUUID()}`, code);
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setSvg("");
          setError("The diagram could not be rendered. Showing the raw Mermaid source instead.");
        }
      }
    }
    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="mermaid-error">
        <p>{error}</p>
        <pre>{code || content}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-loading" aria-label="Rendering diagram">
        <Loader2 className="spin" size={16} aria-hidden="true" />
        <span>Rendering diagram...</span>
      </div>
    );
  }

  return <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: svg }} aria-label="Mermaid diagram" />;
}

// ---------------------------------------------------------------------------
// SourceItem
// ---------------------------------------------------------------------------
function SourceItem({ source, tone, score }) {
  return (
    <div className="source-item">
      <div className={`doc-icon tone-${tone}`} aria-hidden="true">
        <FileText size={18} />
      </div>
      <div>
        <strong>{source.source_document ?? source.label?.split(" (")[0]}</strong>
        <span>Page {source.page_number ?? "—"}</span>
      </div>
      <em aria-label={`Relevance score ${score}%`}>{score}%</em>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MindMap — static SVG placeholder, clearly labelled as such
// ---------------------------------------------------------------------------
function MindMap() {
  return (
    <div className="mindmap">
      <p className="empty-hint mindmap-hint">
        Ask a question to generate a mind map from your documents.
      </p>
      <div className="zoom-stack" aria-hidden="true">
        <button disabled aria-label="Zoom in">+</button>
        <button disabled aria-label="Zoom out">-</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
createRoot(document.getElementById("root")).render(<App />);
