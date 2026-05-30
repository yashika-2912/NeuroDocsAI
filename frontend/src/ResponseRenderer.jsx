import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import mermaid from "./mermaid-init";

export class RenderErrorBoundary extends React.Component {
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

function inferResponseType(message) {
  if (message.response_type) return message.response_type;
  if (/```mermaid\s+[\s\S]*?```/i.test(message.content ?? "")) return "mermaid";
  if (/^\s*\|.+\|\s*$/m.test(message.content ?? "")) return "table";
  return "text";
}

export function ResponseRenderer({ message }) {
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
      <div className="mermaid-loading">
        <Loader2 className="spin" size={16} />
        <span>Rendering diagram...</span>
      </div>
    );
  }
  return <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: svg }} aria-label="Mermaid diagram" />;
}
