# Implementation Plan: Dynamic Visual Explanations

## Overview

Implement diagram generation by extending the backend LLM prompt layer and adding three frontend components. Diagrams flow through the existing SSE stream — no new API endpoints required.

## Tasks

- [ ] 1. Add diagram intent detection to the backend LLM service
  - [ ] 1.1 Add `DIAGRAM_KEYWORDS` and `MERMAID_KEYWORD` constants to `app/services/llm.py`
    - Define the keyword-to-type mapping and type-to-Mermaid-syntax mapping as module-level constants
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 1.2 Write property tests for keyword detection constants
    - **Property 3: Mermaid keyword mapping is total**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Use Hypothesis `st.sampled_from` over the four type strings; assert `MERMAID_KEYWORD[t]` is non-empty and starts with a valid Mermaid keyword
    - Tag: `Feature: dynamic-visual-explanations, Property 3: mermaid keyword mapping is total`

  - [ ] 1.3 Implement `DiagramIntent` dataclass and `detect_diagram_intent(message: str) -> DiagramIntent | None` in `app/services/llm.py`
    - Case-insensitive keyword scan; first match wins; return `None` if no match
    - _Requirements: 2.1_

  - [ ]* 1.4 Write property tests for `detect_diagram_intent`
    - **Property 1: Explicit keyword detection is exhaustive**
    - **Validates: Requirements 2.1**
    - **Property 2: No false positives in keyword detection**
    - **Validates: Requirements 2.1, 3.1**
    - Use Hypothesis to generate messages with and without keywords; assert correct return values
    - Tag: `Feature: dynamic-visual-explanations, Property 1` and `Property 2`

- [ ] 2. Implement `build_diagram_system_prompt` and wire it into the LLM service
  - [ ] 2.1 Implement `build_diagram_system_prompt(intent: DiagramIntent | None) -> str` in `app/services/llm.py`
    - When `intent` is `None`: return `SYSTEM_PROMPT` with the auto-detection standing clause appended
    - When `intent` is not `None`: return `SYSTEM_PROMPT` with explicit diagram instructions (using `MERMAID_KEYWORD[intent.diagram_type]`) but WITHOUT the auto-detection clause
    - _Requirements: 3.1, 3.4, 7.1, 7.4_

  - [ ]* 2.2 Write property tests for `build_diagram_system_prompt`
    - **Property 7: Prompt exclusivity — no double diagram instructions**
    - **Validates: Requirements 3.4, 7.4**
    - **Property 8: Prompt contains correct Mermaid keyword for explicit intent**
    - **Validates: Requirements 7.1**
    - Use Hypothesis to generate `DiagramIntent` objects and `None`; assert prompt contents
    - Tag: `Feature: dynamic-visual-explanations, Property 7` and `Property 8`

  - [ ] 2.3 Update `OpenAIChatService.stream()` and `complete()` to call `detect_diagram_intent` and pass the result to `build_diagram_system_prompt`, using the returned string as the per-call system prompt
    - _Requirements: 7.1, 7.2, 7.4_

  - [ ] 2.4 Update the fallback path in `stream()` to emit a static placeholder Mermaid block when a diagram is requested and `self.client is None`
    - _Requirements: 7.3_

  - [ ]* 2.5 Write property test for fallback diagram
    - **Property 6: Fallback stream always yields a Mermaid block**
    - **Validates: Requirements 7.3**
    - Use Hypothesis `st.sampled_from` over the four diagram types; assert at least one yielded chunk contains ` ```mermaid `
    - Tag: `Feature: dynamic-visual-explanations, Property 6: fallback stream always yields a Mermaid block`

- [ ] 3. Checkpoint — ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add `DiagramButtons` component to the frontend composer
  - [ ] 4.1 Create the `DiagramButtons` component in `frontend/src/main.jsx`
    - Render four buttons: Flowchart, Timeline, Architecture, Concept Map
    - Each button calls `sendMessage` with a canned prompt containing the diagram type name
    - Buttons are `disabled` when `isStreaming` is `true`
    - Each button has a descriptive `aria-label`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.2_

  - [ ]* 4.2 Write property test for `DiagramButtons`
    - **Property 11: Diagram button click sends correct diagram type keyword**
    - **Validates: Requirements 1.2**
    - Use fast-check to generate button index; mock `sendMessage`; assert called string contains the correct type name
    - Tag: `Feature: dynamic-visual-explanations, Property 11: diagram button click sends correct diagram type keyword`

  - [ ] 4.3 Mount `DiagramButtons` inside the `.composer-actions` div in `App`, passing `sendMessage` and `isStreaming`
    - _Requirements: 1.1, 1.3_

- [ ] 5. Update `ChatMessageView` for improved Mermaid rendering
  - [ ] 5.1 Refactor the Mermaid rendering logic in `ChatMessageView` to split message content on ` ```mermaid...``` ` boundaries and render prose sections and diagram sections in order
    - _Requirements: 4.1, 4.3_

  - [ ] 5.2 Add error handling: when `mermaid.render()` rejects, display the raw Mermaid source in a `<pre>` with an "Unable to render diagram" notice and a text alternative describing the diagram type
    - _Requirements: 4.2, 8.4_

  - [ ] 5.3 Add `aria-label` to the SVG wrapper element, including the diagram type derived from the Mermaid declaration keyword
    - _Requirements: 8.1_

  - [ ] 5.4 Add `onDiagramRendered` callback prop to `ChatMessageView`; call it with `{ id, svg, diagramType, messageId, timestamp }` after each successful render
    - _Requirements: 5.1_

  - [ ]* 5.5 Write property tests for `ChatMessageView` rendering
    - **Property 9: Rendered diagram wrapper has aria-label**
    - **Validates: Requirements 8.1**
    - **Property 10: Mixed-content messages render both prose and diagram**
    - **Validates: Requirements 4.3**
    - Use fast-check to generate arbitrary prose strings and valid Mermaid snippets; assert output structure
    - Tag: `Feature: dynamic-visual-explanations, Property 9` and `Property 10`

- [ ] 6. Implement `VisualizationsPanel` and wire it into the right panel
  - [ ] 6.1 Add `visualizations` state array to `App` and pass `onDiagramRendered` down to `ChatMessageView` to populate it
    - Each entry: `{ id, svg, diagramType, messageId, timestamp }`
    - _Requirements: 5.1_

  - [ ] 6.2 Create the `VisualizationsPanel` component in `frontend/src/main.jsx`
    - Empty state: render placeholder text "Diagrams generated during this session will appear here."
    - Populated state: render entries in reverse-chronological order, each showing type label, timestamp, and SVG thumbnail
    - _Requirements: 5.3, 5.4, 5.5_

  - [ ]* 6.3 Write property tests for `VisualizationsPanel`
    - **Property 4: Diagram entry completeness round-trip**
    - **Validates: Requirements 5.1, 5.5**
    - **Property 5: Visualizations panel reverse-chronological ordering**
    - **Validates: Requirements 5.4**
    - Use fast-check to generate arbitrary arrays of `DiagramEntry` objects; assert rendered order and field presence
    - Tag: `Feature: dynamic-visual-explanations, Property 4` and `Property 5`

  - [ ] 6.4 Add an expanded view modal to `VisualizationsPanel`: clicking an entry opens a full-size SVG view with a close button; trap keyboard focus inside the modal; close on `Escape`
    - _Requirements: 5.2, 8.3_

  - [ ] 6.5 Replace the empty "Visualizations" tab body in `App` with `<VisualizationsPanel diagrams={visualizations} />`
    - _Requirements: 5.3, 5.4_

- [ ] 7. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Diagrams flow through the existing SSE stream — no new API endpoints are needed
- Property tests use Hypothesis (Python backend) and fast-check (JS frontend), minimum 100 iterations each
