import { describe, expect, test } from "bun:test";
import type { ChatTurnRequest } from "../lib/chat-types";
import { toAgentTurnInput } from "./pi-chat-transport";

describe("pi chat transport mapping", () => {
  test("keeps image references separate from selections and brings back recent displayed images", () => {
    const request: ChatTurnRequest = {
      bookId: "book-1", bookTitle: "A Book",
      message: { id: "new", role: "user", content: "Compare these", createdAt: "now", attachments: [
        { kind: "image", cacheKey: "new-image", name: "upload.png" },
      ] },
      history: [
        { id: "old", role: "user", content: "Old image", createdAt: "then", attachments: [{ kind: "image", cacheKey: "old-image", name: "old.png" }] },
        { id: "previous-user", role: "user", content: "Find a diagram", createdAt: "now", attachments: [{ kind: "image", cacheKey: "previous-image", name: "previous.png" }] },
        { id: "previous-answer", role: "assistant", content: "A diagram", createdAt: "now", parts: [{
          type: "reference", id: "shown", reference: { kind: "web-images", images: [{
            url: "https://example.org/image.png", thumbnailUrl: "https://example.org/thumb.png",
            sourceUrl: "https://example.org/page", title: "Diagram", caption: "A diagram",
          }] },
        }] },
      ],
    };
    const input = toAgentTurnInput(request);
    expect(input.attachments).toEqual([]);
    expect(input.images).toEqual([{ kind: "local", cacheKey: "new-image", name: "upload.png" }]);
    expect(input.contextImages).toEqual([
      { kind: "web", url: "https://example.org/image.png", thumbnailUrl: "https://example.org/thumb.png", name: "Diagram" },
      { kind: "local", cacheKey: "previous-image", name: "previous.png" },
    ]);
  });

  test("preserves both selection context and the live reader position", () => {
    const request: ChatTurnRequest = {
      bookId: "book-1",
      bookTitle: "A Book",
      history: [],
      message: {
        id: "message-1",
        role: "user",
        content: "How should I read this?",
        createdAt: "2026-08-02T00:00:00Z",
        attachments: [
          {
            kind: "selection",
            text: "Selected prose",
            cfiRange: "epubcfi(/6/4!/2/2)",
            chapterHref: "chapter-2.xhtml",
          },
        ],
      },
      readingCursor: {
        anchor: "epubcfi(/6/4!/4/2)",
        chapter: "chapter-2.xhtml",
        chapterTitle: "Chapter 2",
        bookProgress: 0.42,
        chapterProgress: 0.6,
        location: { current: 84, total: 200 },
        visibleText: "The page currently visible to the reader.",
      },
    };

    expect(toAgentTurnInput(request)).toEqual({
      text: "How should I read this?",
      images: [],
      contextImages: [],
      attachments: [
        {
          text: "Selected prose",
          anchor: "epubcfi(/6/4!/2/2)",
          chapter: "chapter-2.xhtml",
        },
      ],
      readingCursor: {
        anchor: "epubcfi(/6/4!/4/2)",
        chapter: "chapter-2.xhtml",
        chapterTitle: "Chapter 2",
        bookProgress: 0.42,
        chapterProgress: 0.6,
        location: { current: 84, total: 200 },
        visibleText: "The page currently visible to the reader.",
      },
      signal: undefined,
      reset: undefined,
      retry: undefined,
      turnId: "message-1",
    });
  });
});
