# Requirements Document

## Introduction

This feature adds dynamic visual diagram generation to NeuroDocs AI. The system will both respond to explicit user requests for diagrams and proactively generate them when a visual explanation would aid understanding. Diagrams are rendered inline in the chat using the existing Mermaid.js integration and are also surfaced in the right panel's "Visualizations" tab. Supported diagram types are: flowcharts, timelines, architecture diagrams, and concept maps.

## Glossary

- **Diagram_Generator**: The backend component responsible for detecting diagram intent and producing Mermaid diagram syntax.
- **Diagram_Request**: A user-initiated request for a specific diagram type, triggered via a UI button or natural language.
- **Auto_Detection**: The backend logic that determines whether a visual explanation would improve a response, without an explicit user request.
- **Mermaid_Renderer**: The existing frontend component (`ChatMessageView`) that detects ` ```mermaid ` code blocks and renders them as SVG.
- **Visualizations_Panel**: The right panel tab labelled "Visualizations" that displays a history of diagrams generated in the current session.
- **Diagram_Type**: One of: `flowchart`, `timeline`, `architecture`, `concept_map`.
- **LLM_Service**: The `OpenAIChatService` in `app/services/llm.py` that generates text responses via the OpenAI API.
- **SSE_Stream**: The Server-Sent Events stream at `/api/chat/stream` used to deliver chat responses to the frontend.

---

## Requirements

### Requirement 1: Explicit Diagram Request via UI Buttons

**User Story:** As a user, I want to click dedicated diagram-type buttons to request a specific visual diagram, so that I can get structured visual explanations without having to type a prompt.

#### Acceptance Criteria

1. THE Chat_Composer SHALL display at minimum four diagram-type buttons: Flowchart, Timeline, Architecture, and Concept Map.
2. WHEN a user clicks a diagram-type button, THE Chat_Composer SHALL send a chat message requesting that specific diagram type based on the current document context.
3. WHEN a diagram-type button is clicked while a response is streaming, THE Chat_Composer SHALL disable all diagram-type buttons until streaming completes.
4. THE Chat_Composer SHALL render diagram-type buttons with accessible labels and keyboard focus support.

---

### Requirement 2: Explicit Diagram Request via Natural Language

**User Story:** As a user, I want to describe a diagram I need in plain text, so that I can request custom visual explanations conversationally.

#### Acceptance Criteria

1. WHEN a user's message contains a request for a diagram (e.g., "show me a flowchart", "draw a timeline", "create an architecture diagram"), THE Diagram_Generator SHALL produce a Mermaid code block of the appropriate Diagram_Type.
2. WHEN the user's message references a diagram type not in the supported set, THE Diagram_Generator SHALL respond with the closest supported Diagram_Type and explain the substitution.
3. WHEN the user's message is ambiguous about diagram type, THE Diagram_Generator SHALL default to `concept_map` and include a note that the user can request a different type.

---

### Requirement 3: Proactive Auto-Detection of Diagram Opportunities

**User Story:** As a user, I want the AI to automatically generate a diagram when it would help explain a concept, so that I receive richer answers without having to ask explicitly.

#### Acceptance Criteria

1. WHEN the LLM_Service determines that a response describes a process, sequence, hierarchy, or system with three or more distinct components, THE Diagram_Generator SHALL append a Mermaid code block to the response.
2. WHEN auto-detection produces a diagram, THE Diagram_Generator SHALL include a brief label (e.g., "Visual summary:") immediately before the Mermaid code block.
3. WHEN the retrieved document context contains no structured content suitable for a diagram, THE Diagram_Generator SHALL omit the diagram and respond with text only.
4. WHEN a response already contains an explicit diagram from a user request (Requirement 1 or 2), THE Diagram_Generator SHALL NOT append an additional auto-detected diagram.

---

### Requirement 4: Inline Diagram Rendering in Chat

**User Story:** As a user, I want diagrams to appear directly inside the chat conversation, so that I can see visual explanations in context with the surrounding text.

#### Acceptance Criteria

1. WHEN an assistant message contains a ` ```mermaid ` code block, THE Mermaid_Renderer SHALL render it as an SVG image inline within the message bubble.
2. WHEN a Mermaid diagram fails to render due to invalid syntax, THE Mermaid_Renderer SHALL display the raw Mermaid source code in a styled code block with an error notice.
3. WHEN a message contains both prose and a Mermaid code block, THE Mermaid_Renderer SHALL render the prose above the diagram, preserving the full message content.
4. WHEN a diagram is rendered, THE Mermaid_Renderer SHALL apply a visible border and padding to visually distinguish the diagram from surrounding text.

---

### Requirement 5: Visualizations Panel

**User Story:** As a user, I want all generated diagrams to be collected in the right panel's "Visualizations" tab, so that I can review and revisit diagrams without scrolling through the chat.

#### Acceptance Criteria

1. WHEN a diagram is rendered in the chat, THE Visualizations_Panel SHALL add an entry for that diagram including its Diagram_Type label and a thumbnail or full SVG rendering.
2. WHEN the user clicks a diagram entry in the Visualizations_Panel, THE Visualizations_Panel SHALL display the diagram at full size in an expanded view.
3. WHEN no diagrams have been generated in the current session, THE Visualizations_Panel SHALL display a placeholder message indicating that diagrams will appear here.
4. WHEN the user switches to the "Visualizations" tab, THE Visualizations_Panel SHALL show all diagrams generated in the current session in reverse-chronological order.
5. WHEN a diagram entry is displayed in the Visualizations_Panel, THE Visualizations_Panel SHALL show the diagram type and the timestamp of generation.

---

### Requirement 6: Diagram Type Support

**User Story:** As a user, I want the system to support at least four diagram types, so that I can get the most appropriate visual format for different kinds of content.

#### Acceptance Criteria

1. THE Diagram_Generator SHALL support the `flowchart` type using Mermaid `flowchart TD` syntax for process and decision flows.
2. THE Diagram_Generator SHALL support the `timeline` type using Mermaid `timeline` syntax for chronological sequences.
3. THE Diagram_Generator SHALL support the `architecture` type using Mermaid `graph LR` or `C4Context` syntax for system component relationships.
4. THE Diagram_Generator SHALL support the `concept_map` type using Mermaid `mindmap` syntax for hierarchical concept relationships.
5. WHEN the LLM_Service generates a diagram, THE Diagram_Generator SHALL produce syntactically valid Mermaid code for the selected Diagram_Type.

---

### Requirement 7: Backend Diagram Generation via LLM

**User Story:** As a developer, I want the backend to handle diagram generation through the existing LLM service, so that diagram content is grounded in the retrieved document context.

#### Acceptance Criteria

1. WHEN a diagram is requested, THE LLM_Service SHALL receive a system prompt instructing it to produce a Mermaid code block of the specified Diagram_Type grounded in the retrieved document context.
2. WHEN streaming a response that includes a diagram, THE SSE_Stream SHALL deliver the Mermaid code block as part of the normal `delta` event stream without a separate endpoint.
3. WHEN the LLM_Service is operating in fallback mode (no API key), THE Diagram_Generator SHALL return a static placeholder Mermaid diagram with a note that full generation requires an API key.
4. THE LLM_Service SHALL include diagram generation instructions in the system prompt only when a diagram has been requested or auto-detection criteria are met.

---

### Requirement 8: Accessibility and Usability

**User Story:** As a user, I want diagrams and diagram controls to be accessible, so that the feature works for all users including those using assistive technologies.

#### Acceptance Criteria

1. WHEN a diagram SVG is rendered, THE Mermaid_Renderer SHALL include an `aria-label` attribute describing the diagram type and source context.
2. THE Chat_Composer diagram-type buttons SHALL each have a descriptive `aria-label` attribute.
3. WHEN the Visualizations_Panel expanded view is open, THE Visualizations_Panel SHALL trap keyboard focus within the expanded view and provide a visible close control.
4. WHEN a diagram fails to render, THE Mermaid_Renderer SHALL provide a text alternative conveying that a diagram was attempted and the type it represents.
