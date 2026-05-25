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
  Filter,
  GitCompare,
  GitFork,
  GraduationCap,
  Link,
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
  Upload,
  Zap
} from "lucide-react";
import "./styles.css";
import Login from "./Login";
import Register from "./Register";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

const starterDocuments = [
  { filename: "Operating Systems Notes.pdf", size_bytes: 12400000, page_count: 230, id: "sample-os" },
  { filename: "Database Management.pdf", size_bytes: 8700000, page_count: 189, id: "sample-db" },
  { filename: "Computer Networks.pdf", size_bytes: 15200000, page_count: 312, id: "sample-cn" },
  { filename: "AI Research Papers.pdf", size_bytes: 10100000, page_count: 145, id: "sample-ai" },
  { filename: "ML Algorithms Guide.pdf", size_bytes: 7300000, page_count: 98, id: "sample-ml" }
];

const quickPrompts = {
  Summarize: "Summarize the uploaded documents with citations.",
  "Generate Quiz": "Generate five quiz questions from the retrieved document context.",
  "Create Flashcards": "Create flashcards from the most important concepts.",
  "Compare Docs": "Compare the uploaded documents and show key differences.",
  "Show Mermaid Diagram": "Create a Mermaid diagram summarizing the main concepts.",
  "Show Table": "Show a table comparing the main documents or concepts.",
  "Show Research Summary": "Generate a research summary from the uploaded documents."
};

function formatBytes(bytes = 0) {
  if (!bytes) return "PDF";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function documentTone(index) {
  return ["red", "blue", "green", "violet", "amber"][index % 5];
}

function App() {
  const [documents, setDocuments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([
    {
      id: "welcome-user",
      role: "user",
      content: "Explain deadlock in operating systems with example and prevention techniques.",
      created_at: new Date().toISOString()
    },
    {
      id: "welcome-assistant",
      role: "assistant",
      content:
        "Deadlock is a situation in operating systems where two or more processes are blocked forever, each waiting for a resource held by another process in the group.\n\n### Example\nConsider two processes P1 and P2 and two resources R1 and R2.\n\n- P1 holds R1 and requests R2.\n- P2 holds R2 and requests R1.\n\nNeither can proceed, resulting in a deadlock.\n\n### Necessary Conditions (Coffman Conditions)\n1. **Mutual Exclusion** - Resources cannot be shared.\n2. **Hold and Wait** - Process holds at least one resource and waits for others.\n3. **No Preemption** - Resources cannot be forcibly taken; they must be released voluntarily.\n4. **Circular Wait** - A circular chain of processes exists, each waiting for a resource held by the next.\n\n### Prevention Techniques\n- **Mutual Exclusion** - Not required for sharable resources.\n- **Hold and Wait** - Require processes to request all resources at once.\n- **No Preemption** - Allow resource preemption if a process cannot proceed.\n- **Circular Wait** - Impose an ordering on resources and request in order.",
      created_at: new Date().toISOString(),
      citations: [
        { label: "Operating Systems Notes.pdf (p. 45)", source_document: "Operating Systems Notes.pdf", page_number: 45 },
        { label: "Operating Systems Notes.pdf (p. 47)", source_document: "Operating Systems Notes.pdf", page_number: 47 },
        { label: "Computer Networks.pdf (p. 103)", source_document: "Computer Networks.pdf", page_number: 103 }
      ]
    }
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rightTab, setRightTab] = useState("Sources");
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  const visibleDocuments = documents.length ? documents : starterDocuments;
  const latestCitations = useMemo(() => {
    const fromMessages = [...messages].reverse().find((message) => message.citations?.length);
    return fromMessages?.citations ?? [];
  }, [messages]);

  const [authMode, setAuthMode] = useState("login");
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadDocuments();
    loadSessions();
  }, []);

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
    const pdfs = Array.from(files || []).filter((file) => file.type === "application/pdf" || file.name.endsWith(".pdf"));
    if (!pdfs.length) return;

    const formData = new FormData();
    pdfs.forEach((file) => formData.append("files", file));
    setUploading(true);
    try {
      const response = await fetch(`${API_BASE}/api/documents/upload`, {
        method: "POST",
        body: formData
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

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      created_at: new Date().toISOString()
    };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString(), citations: [] }
    ]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, session_id: activeSessionId, top_k: 5 })
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
        for (const block of blocks) processSseBlock(block, assistantId);
      }
      if (buffer) processSseBlock(buffer, assistantId);
      await loadSessions();
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
              ...message,
              content: `I could not reach the chat service. ${error.message}`
            }
            : message
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function processSseBlock(block, assistantId) {
    const event = block
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.replace("event:", "")
      .trim();
    const dataLine = block
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.replace("data:", "")
      .trim();
    if (!event || !dataLine) return;

    const data = JSON.parse(dataLine);
    if (event === "session") {
      setActiveSessionId(data.session_id);
    }
    if (event === "citations") {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, citations: data } : message))
      );
    }
    if (event === "delta") {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: `${message.content}${data.text}` } : message
        )
      );
    }
  }

  function copyMessage(content) {
    navigator.clipboard?.writeText(content);
  }

  if (!user) {
    return authMode === "login" ? (
      <Login onLogin={setUser} switchToRegister={() => setAuthMode("register")} />
    ) : (
      <Register onRegister={setUser} switchToLogin={() => setAuthMode("login")} />
    );
  }

  return (
    <div className="app-shell">
      <TopBar user={user} onLogout={() => setUser(null)} />
      <div className="workspace">
        <aside className="left-sidebar">
          <button className="upload-button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
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
            <div className="doc-list">
              {visibleDocuments.map((doc, index) => (
                <DocumentItem key={doc.id ?? doc.filename} doc={doc} tone={documentTone(index)} />
              ))}
            </div>
          </section>

          <section className="sidebar-section history-section">
            <h2>Chat History</h2>
            <p className="section-kicker">Today</p>
            <div className="history-list">
              {(sessions.length ? sessions : mockSessions()).slice(0, 5).map((session, index) => (
                <button
                  key={session.id}
                  className={`history-item ${session.id === activeSessionId || index === 0 ? "active" : ""}`}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span>{session.title}</span>
                  <time>{index < 2 ? "10:45 AM" : index < 4 ? "Yesterday" : "2 days ago"}</time>
                </button>
              ))}
            </div>
            <button className="view-all">
              View all chats <Zap size={16} />
            </button>
          </section>
        </aside>

        <main className="chat-column">
          <div className="hero-copy">
            <h1>How can I help you today?</h1>
            <p>Ask questions about your documents, generate summaries, or explore concepts.</p>
          </div>

          <div className="message-stream" ref={scrollRef}>
            {messages.map((message) => (
              <ChatMessageView key={message.id} message={message} onCopy={copyMessage} />
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
              placeholder="Ask follow-up questions..."
              rows={2}
            />
            <div className="composer-actions">
              <button type="button">
                <Filter size={17} /> Filter
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Paperclip size={17} /> Attach
              </button>
              <button type="button" onClick={() => sendMessage("Create a mind map from my documents.")}>
                <GitFork size={17} /> Mind Map
              </button>
              <button className="send-button" type="button" onClick={() => sendMessage()} disabled={isStreaming}>
                {isStreaming ? <Loader2 className="spin" size={19} /> : <Send size={19} />}
              </button>
            </div>
          </div>
        </main>

        <aside className="right-panel">
          <section className="insight-card sources-card">
            <div className="tabs">
              {["Sources", "Visualizations", "Tools"].map((tab) => (
                <button key={tab} className={rightTab === tab ? "active" : ""} onClick={() => setRightTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="panel-body">
              <h3>Top Sources</h3>
              <div className="source-list">
                {(latestCitations.length ? latestCitations : fallbackCitations()).slice(0, 4).map((source, index) => (
                  <SourceItem key={`${source.label}-${index}`} source={source} tone={documentTone(index)} score={92 - index * 9} />
                ))}
              </div>
              <button className="all-sources">
                See all sources <Zap size={15} />
              </button>
            </div>
          </section>

          <section className="insight-card mindmap-card">
            <div className="card-title-row">
              <h3>Mind Map</h3>
              <button className="icon-button" aria-label="Expand mind map">
                <Maximize2 size={16} />
              </button>
            </div>
            <MindMap />
          </section>

          <section className="insight-card">
            <h3>Quick Actions</h3>
            <div className="quick-grid">
              {Object.entries(quickPrompts).map(([label, prompt], index) => (
                <button key={label} className={`quick-action tone-${documentTone(index + 2)}`} onClick={() => sendMessage(prompt)}>
                  {quickIcon(label)}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function TopBar({ user, onLogout }) {
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
      <label className="global-search">
        <Search size={20} />
        <input placeholder="Search your documents..." />
        <kbd>⌘ K</kbd>
      </label>
      <div className="top-actions">
        <button className="icon-button" aria-label="Theme">
          <Sun size={20} />
        </button>
        <button className="icon-button" aria-label="Notifications">
          <Bell size={20} />
        </button>
        {user ? (
          <>
            <div className="avatar">{user.email[0].toUpperCase()}</div>
            <strong>{user.email}</strong>
            <button className="icon-button" onClick={onLogout} title="Logout">
              <ChevronDown size={18} />
            </button>
          </>
        ) : null}
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
        <strong>{doc.filename}</strong>
        <span>
          PDF · {formatBytes(doc.size_bytes)} {doc.page_count ? `· ${doc.page_count} pages` : ""}
        </span>
      </div>
      <button className="icon-button compact" aria-label="Document menu">
        <MoreVertical size={17} />
      </button>
    </div>
  );
}

function ChatMessageView({ message, onCopy }) {
  const isUser = message.role === "user";
  // Mermaid rendering
  const [mermaidSvg, setMermaidSvg] = React.useState(null);
  React.useEffect(() => {
    if (message.content && message.content.includes('```mermaid')) {
      const match = message.content.match(/```mermaid\n([\s\S]*?)```/);
      if (match) {
        mermaid.render(`mermaid-${message.id}`, match[1])
          .then(({ svg }) => setMermaidSvg(svg))
          .catch(() => setMermaidSvg(null));
      }
    } else {
      setMermaidSvg(null);
    }
  }, [message.content, message.id]);

  return (
    <article className={`message-row ${isUser ? "user-row" : "assistant-row"}`}>
      {!isUser && (
        <div className="assistant-badge">
          <Sparkles size={18} />
        </div>
      )}
      <div className={`message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
        {message.content ? (
          mermaidSvg ? (
            <div dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          )
        ) : (
          <div className="message-skeleton">
            <span />
            <span />
            <span />
          </div>
        )}
        {!isUser && message.content && (
          <footer className="message-footer">
            <span>Sources: {message.citations?.length ?? 0}</span>
            <button aria-label="Helpful">
              <ThumbsUp size={15} />
            </button>
            <button aria-label="Not helpful">
              <ThumbsDown size={15} />
            </button>
            <button className="copy-button" onClick={() => onCopy(message.content)}>
              <Copy size={15} /> Copy
            </button>
          </footer>
        )}
      </div>
      {isUser && <div className="user-badge">A</div>}
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
      <em>{score}%</em>
    </div>
  );
}

function MindMap() {
  return (
    <div className="mindmap">
      <svg viewBox="0 0 520 270" role="img" aria-label="Concept mind map">
        <path d="M130 135 C210 58 224 42 292 42" className="line blue" />
        <path d="M130 135 C220 94 230 86 294 86" className="line purple" />
        <path d="M130 135 C224 136 245 136 306 136" className="line red" />
        <path d="M130 135 C224 198 246 214 310 218" className="line green" />
        <path d="M370 136 C398 104 420 98 468 100" className="line red" />
        <path d="M370 136 C400 132 420 130 468 130" className="line red" />
        <path d="M370 136 C400 166 420 170 468 170" className="line red" />
        <path d="M376 218 C408 198 424 194 468 194" className="line green" />
        <path d="M376 218 C410 220 426 220 468 220" className="line green" />
        <path d="M376 218 C408 242 424 244 468 244" className="line green" />
        <MindNode x={42} y={118} w={88} h={34} text="Deadlock" tone="root" />
        <MindNode x={292} y={26} w={88} h={28} text="Definition" tone="blue" />
        <MindNode x={294} y={72} w={78} h={28} text="Example" tone="purple" />
        <MindNode x={306} y={120} w={92} h={30} text="Conditions" tone="red" />
        <MindNode x={310} y={202} w={96} h={30} text="Prevention" tone="green" />
        <MiniNode x={454} y={88} text="Mutual Exclusion" />
        <MiniNode x={458} y={118} text="Hold and Wait" />
        <MiniNode x={460} y={158} text="Circular Wait" />
        <MiniNode x={452} y={182} text="Break Conditions" green />
        <MiniNode x={452} y={208} text="Resource Ordering" green />
        <MiniNode x={456} y={232} text="Avoid Hold and Wait" green />
      </svg>
      <div className="zoom-stack">
        <button>+</button>
        <button>-</button>
      </div>
    </div>
  );
}

function MindNode({ x, y, w, h, text, tone }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" className={`mind-node ${tone}`} />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function MiniNode({ x, y, text, green = false }) {
  return (
    <g>
      <rect x={x} y={y} width="92" height="20" rx="7" className={green ? "mini-node green" : "mini-node"} />
      <text x={x + 46} y={y + 13} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function quickIcon(label) {
  const props = { size: 17 };
  if (label === "Summarize") return <MessageSquareText {...props} />;
  if (label === "Generate Quiz") return <GraduationCap {...props} />;
  if (label === "Create Flashcards") return <BrainCircuit {...props} />;
  return <GitCompare {...props} />;
}

function fallbackCitations() {
  return [
    { label: "Operating Systems Notes.pdf (p. 45)", source_document: "Operating Systems Notes.pdf", page_number: 45 },
    { label: "Operating Systems Notes.pdf (p. 47)", source_document: "Operating Systems Notes.pdf", page_number: 47 },
    { label: "Computer Networks.pdf (p. 103)", source_document: "Computer Networks.pdf", page_number: 103 }
  ];
}

function mockSessions() {
  return [
    { id: "mock-1", title: "Explain deadlock in OS" },
    { id: "mock-2", title: "Compare SQL vs NoSQL" },
    { id: "mock-3", title: "TCP handshake process" },
    { id: "mock-4", title: "Normalization in DBMS" },
    { id: "mock-5", title: "Types of Machine Learning" }
  ];
}

createRoot(document.getElementById("root")).render(<App />);
