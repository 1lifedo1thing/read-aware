import { Fragment } from "react";

/** API doc comments as text, with their `inline code` spans rendered as code. */
export function PluginDocText({ text }: { text: string }) {
  let offset = 0;
  return (
    <>
      {text.split(/(`[^`\n]+`)/g).map((part) => {
        // A part's offset in the source text is unique, so it keys the node.
        const key = offset;
        offset += part.length;
        return part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={key}>{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={key}>{part}</Fragment>
        );
      })}
    </>
  );
}
