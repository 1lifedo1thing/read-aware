import { Streamdown } from "streamdown";
import { cn } from "@read-aware/ui/cn";

const components = { img: ({ alt }: { alt?: string }) => alt ? <span>{alt}</span> : null };

/**
 * Renders assistant replies as Markdown via Streamdown (handles partial/unclosed
 * Markdown mid-stream out of the box). Kept deliberately quiet for the reader's
 * editorial surface: no copy/download chrome, no code line numbers. Streamdown's
 * shadcn-style color utilities are remapped onto our palette in `index.css`, so
 * it inherits the paper theme and dark mode automatically.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      controls={false}
      lineNumbers={false}
      // Retrieved images use source-backed reference cards. Do not let prose
      // invent arbitrary remote image requests (including while streaming).
      components={components}
      className={cn("ra-chat-markdown", className)}
    >
      {children}
    </Streamdown>
  );
}
