# Mermaid PNG Tool

Daycare provides a built-in tool named `generate_mermaid_png` for agents to render Mermaid diagrams into PNG files.

## Parameters

- `mermaid` (required): Mermaid source string. Supports raw Mermaid text or a fenced block.
- `name` (optional): Output file name. `.png` is appended if missing.
- `theme` (optional): Mermaid theme name from `beautiful-mermaid` (default: `github-light`).
- `width` (optional): Output image width in pixels, range `256..4096` (default: `1600`).

## Result

The tool stores the generated PNG in the file store and returns it as a generated file artifact so connectors can send it to users.

## Flow

```mermaid
flowchart LR
  A[Tool Call: generate_mermaid_png] --> B[Resolve Mermaid Source]
  B --> C[Render SVG with beautiful-mermaid]
  C --> D[Convert SVG to PNG with resvg]
  D --> E[Store via FileStore.saveBuffer]
  E --> F[Return file artifact to agent loop]
```
