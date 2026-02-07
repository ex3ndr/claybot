import { Type } from "@sinclair/typebox";
import { Resvg } from "@resvg/resvg-js";
import { THEMES, renderMermaid } from "beautiful-mermaid";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "@/types";

const schema = Type.Object(
  {
    mermaid: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String({ minLength: 1 })),
    theme: Type.Optional(Type.String({ minLength: 1 })),
    width: Type.Optional(Type.Integer({ minimum: 256, maximum: 4096 }))
  },
  { additionalProperties: false }
);

type MermaidPngArgs = {
  mermaid: string;
  name?: string;
  theme?: string;
  width?: number;
};

/**
 * Builds a tool that renders Mermaid diagram source into a PNG file.
 * Expects: args.mermaid contains Mermaid source (raw or ```mermaid fenced), optional theme exists in THEMES.
 */
export function buildMermaidPngTool(): ToolDefinition<typeof schema> {
  return {
    tool: {
      name: "generate_mermaid_png",
      description:
        "Render Mermaid diagram source into a PNG file and return it as a generated artifact.",
      parameters: schema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as MermaidPngArgs;
      const themeName = payload.theme ?? "github-light";
      const theme = THEMES[themeName as keyof typeof THEMES];
      if (!theme) {
        const available = Object.keys(THEMES).sort().join(", ");
        throw new Error(`Unknown Mermaid theme: ${themeName}. Available themes: ${available}`);
      }

      const diagram = mermaidSourceResolve(payload.mermaid);
      if (diagram.length === 0) {
        throw new Error("Mermaid source is empty.");
      }

      const svg = await renderMermaid(diagram, theme);
      const png = new Resvg(svg, {
        fitTo: { mode: "width", value: payload.width ?? 1600 }
      })
        .render()
        .asPng();
      const stored = await context.fileStore.saveBuffer({
        name: mermaidPngNameResolve(payload.name),
        mimeType: "image/png",
        data: Buffer.from(png),
        source: "generate_mermaid_png"
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Generated Mermaid PNG ${stored.name}.`
          }
        ],
        details: {
          fileId: stored.id,
          name: stored.name,
          mimeType: stored.mimeType,
          size: stored.size,
          theme: themeName,
          width: payload.width ?? 1600
        },
        isError: false,
        timestamp: Date.now()
      };

      return {
        toolMessage,
        files: [
          {
            id: stored.id,
            name: stored.name,
            mimeType: stored.mimeType,
            size: stored.size,
            path: stored.path
          }
        ]
      };
    }
  };
}

function mermaidSourceResolve(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const fencedMatch = trimmed.match(/```mermaid[^\n]*\n([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function mermaidPngNameResolve(requestedName?: string): string {
  const fallback = `mermaid-${Date.now()}.png`;
  if (!requestedName) {
    return fallback;
  }

  const trimmed = requestedName.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  if (trimmed.toLowerCase().endsWith(".png")) {
    return trimmed;
  }
  return `${trimmed}.png`;
}
