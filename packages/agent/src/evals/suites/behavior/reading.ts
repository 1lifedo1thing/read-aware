import type { Id } from "@read-aware/core";
import type { BookOverview } from "../../../ports";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import { defineAgentEvalScenario, type AgentEvalScenario } from "../../agent-harness";
import type { AgentEvalObservation, EvalAssessment, EvalSuite } from "../../types";

const NARRATIVE_BOOK_ID = "eval-locked-room" as Id;
const narrativeBook: BookOverview = {
  id: NARRATIVE_BOOK_ID,
  title: "The Locked Room: A Novel",
  narrativity: "narrative",
  spoilerSensitive: true,
  author: "Mira Vale",
  progressPercent: 18,
  status: "reading",
};
const narrativeChapters = [
  {
    title: "Wet Footprints",
    hrefs: ["chapter-1.xhtml"],
    text: "Victor is found dead in a locked study. Mara notices wet footprints, a stopped brass clock, and an unopened letter. Nobody has yet been accused. Later that night, beyond the reader's current position, Mara secretly finds Rowan's silver key beneath the study window.",
  },
  {
    title: "The Confession",
    hrefs: ["chapter-2.xhtml"],
    text: "In the final confession, the detective proves that Rowan killed Victor and staged the locked room with a hidden wire.",
  },
];

function stableCursorContextAssessment(observation: AgentEvalObservation): EvalAssessment {
  const first = observation.modelRequests[0];
  const second = observation.modelRequests[1];
  const stable =
    typeof first?.context.systemPrompt === "string" &&
    first.context.systemPrompt === second?.context.systemPrompt;
  const newestContext = JSON.stringify(second?.context.messages ?? []);
  return assessmentFromChecks([
    {
      id: "context.stable-system-prefix",
      category: "state",
      passed: stable,
      message: stable
        ? "same-chapter system prompt remained byte-stable"
        : "same-chapter system prompt changed between turns",
    },
    {
      id: "context.latest-cursor",
      category: "state",
      passed: newestContext.includes("SECOND-MARKER"),
      message: newestContext.includes("SECOND-MARKER")
        ? "latest cursor reached the second model request"
        : "latest cursor was missing from the second model request",
      expected: "SECOND-MARKER",
    },
  ]);
}

export const readingEvalSuite: EvalSuite<AgentEvalScenario> = {
  id: "reading",
  displayName: "阅读位置与剧透",
  code: "S12",
  description: "阅读光标定位、叙述性剧透策略与说明性图书检索。",
  scenarios: [
    defineAgentEvalScenario({
      id: "narrative-no-spoiler",
      description: "尊重当前光标位置，避免拉取后续情节剧透。",
      tags: ["spoiler", "cursor", "book"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "Based only on what I have read so far, help me reason about the clues without spoiling who killed Victor.",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            bookProgress: 0.18,
            chapterProgress: 0.55,
            visibleText:
              "Victor is found dead in a locked study. Mara notices wet footprints and a stopped brass clock. Nobody has yet been accused.",
          },
        },
      ],
      expectation: {
        answer: { mustNotContain: ["Rowan", "silver key", "hidden wire", "final confession"] },
        tools: { forbidden: ["read_chapter", "search_book_text"] },
      },
      rubric: [
        "Actively helps the reader reason about the visible clues (footprints, stopped clock, unopened letter) instead of deflecting or refusing",
        "Gives no hint about the culprit or evidence beyond the reader's position, not even indirectly",
        "Reads like a thoughtful reading companion: concrete, engaged with this book, no filler",
      ],
    }),
    defineAgentEvalScenario({
      id: "explicit-spoiler",
      description: "允许请求的剧透，但需基于实际书籍文本。",
      tags: ["spoiler", "grant", "retrieval", "book"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "Spoil the novel for me: who killed Victor, and how was the locked room staged?",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            bookProgress: 0.18,
            chapterProgress: 0.55,
            visibleText: "Victor is found dead in a locked study.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["Rowan", "wire"] },
        tools: { requiredAny: ["read_chapter", "search_book_text"], noErrors: true },
      },
    }),
    defineAgentEvalScenario({
      id: "cursor-grounding",
      description: "根据可见的读者文本回答页面级问题。",
      tags: ["cursor", "book"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "What precise clock detail is on the page I am looking at?",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            chapterProgress: 0.55,
            visibleText: "The brass clock stopped at seventeen minutes past nine.",
          },
        },
      ],
      expectation: { answer: { mustContain: ["seventeen", "nine"] } },
    }),
    defineAgentEvalScenario({
      id: "expository-can-look-ahead",
      description: "当前向查找有用且无剧透时，拉取后续材料。",
      tags: ["retrieval", "forward", "book"],
      scope: { kind: "book", bookId: "eval-data-structures" as Id },
      seed: {
        books: [
          {
            id: "eval-data-structures" as Id,
            title: "Practical Data Structures",
            narrativity: "expository",
            spoilerSensitive: false,
            author: "A. N. Author",
            progressPercent: 20,
            status: "reading",
          },
        ],
        chapters: {
          "eval-data-structures": [
            {
              title: "Arrays",
              hrefs: ["arrays.xhtml"],
              text: "Arrays store elements in contiguous memory and offer constant-time indexed access.",
            },
            {
              title: "Balanced Trees",
              hrefs: ["trees.xhtml"],
              text: "This chapter implements red-black trees and explains rotations, recoloring, and logarithmic lookup.",
            },
          ],
        },
      },
      turns: [
        {
          text: "Does this book later cover red-black trees? Check the actual book before answering.",
          readingCursor: {
            chapter: "arrays.xhtml",
            chapterTitle: "Arrays",
            bookProgress: 0.2,
            chapterProgress: 0.7,
            visibleText: "Arrays store elements in contiguous memory.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["red-black"] },
        tools: { requiredAny: ["read_chapter", "search_book_text"], noErrors: true },
      },
    }),
    defineAgentEvalScenario({
      id: "same-chapter-cursor-refresh",
      description: "每轮刷新实时光标，但不使稳定的 prompt 前缀失效。",
      tags: ["cursor", "multi-turn", "book"],
      scope: { kind: "book", bookId: NARRATIVE_BOOK_ID },
      seed: {
        books: [narrativeBook],
        chapters: { [NARRATIVE_BOOK_ID]: narrativeChapters },
      },
      turns: [
        {
          text: "Reply with only the marker visible on this page.",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            chapterProgress: 0.2,
            visibleText: "The page marker is FIRST-MARKER.",
          },
        },
        {
          text: "I turned the page. Reply with only the marker visible now.",
          readingCursor: {
            chapter: "chapter-1.xhtml",
            chapterTitle: "Wet Footprints",
            chapterProgress: 0.3,
            visibleText: "The page marker is SECOND-MARKER.",
          },
        },
      ],
      expectation: {
        answer: { mustContain: ["SECOND-MARKER"], mustNotContain: ["FIRST-MARKER"] },
        tools: { forbidden: ["read_chapter", "search_book_text"] },
      },
      criteria: {
        stableSystemPromptWithinChapter: true,
        secondRequestContainsLatestCursor: true,
      },
      evaluate: (observation) =>
        combineAssessments(
          evaluateAgentTrace(observation, {
            answer: {
              mustContain: ["SECOND-MARKER"],
              mustNotContain: ["FIRST-MARKER"],
            },
            tools: { forbidden: ["read_chapter", "search_book_text"] },
          }),
          stableCursorContextAssessment(observation),
        ),
    }),
    defineAgentEvalScenario({
      id: "cross-book-search",
      description: "通过搜索书架全书文本来回答“哪本书是我的”问题。",
      tags: ["retrieval", "global"],
      scope: { kind: "global", threadId: "reading-cross-book" },
      seed: {
        books: [
          {
            id: "cross-harbor" as Id,
            title: "The Quiet Harbor",
            author: "L. Shore",
            status: "reading",
          },
          {
            id: "cross-mountain" as Id,
            title: "Mountain Paths",
            author: "R. Hale",
            status: "finished",
          },
        ],
        chapters: {
          "cross-harbor": [
            {
              title: "The Keeper",
              text: "Every evening the old lighthouse keeper climbed the spiral stairs to trim the lamp before the fog rolled in.",
            },
          ],
          "cross-mountain": [
            {
              title: "Ridge Line",
              text: "The climbers roped together before crossing the glacier under a cloudless sky.",
            },
          ],
        },
      },
      turns: [{ text: "Which of my books mentions a lighthouse? Quote the spot." }],
      expectation: {
        // mustNotContain 钉住 glm 曾把内部 id 当书名写给用户的缺陷
        answer: { mustContain: ["Quiet Harbor"], mustNotContain: ["cross-harbor"] },
        tools: { required: ["search_book_text"], noErrors: true },
      },
      rubric: [
        "Names The Quiet Harbor as the match and quotes or paraphrases the actual lighthouse passage, without attributing it to the other book",
      ],
    }),
    ...[false, true].map(noCursor => defineAgentEvalScenario({
      id: noCursor ? "factual-history-without-position" : "factual-history-can-look-ahead",
      description: "叙事历史保留人物纪要，但不把后来的真实事件当作剧透。",
      tags: ["spoiler", "retrieval", "forward", "book"],
      scope: { kind: "book" as const, bookId: "eval-reform-history" },
      seed: {
        books: [{ id: "eval-reform-history", title: "改革年代：历史讲义（评测文本）", narrativity: "narrative" as const, spoilerSensitive: false, status: "reading" as const, progressPercent: 10 }],
        chapters: { "eval-reform-history": [
          { title: "早年", hrefs: ["early.xhtml"], text: "本章讨论邓小平早年的留学与政治经历。" },
          { title: "九十年代", hrefs: ["later.xhtml"], text: "1992年南方谈话再次强调发展和改革开放，推动市场化改革提速。讲义用深圳和珠海的考察说明他如何借地方实践推动政策讨论。" },
        ] },
      },
      turns: [{ text: "书里怎么解释邓小平1992年南方谈话对改革的影响？帮我查一下原文。",
        ...(noCursor ? {} : { readingCursor: { chapterIndex: 0, chapter: "early.xhtml", visibleText: "本章讨论邓小平早年的留学与政治经历。" } }) }],
      expectation: { answer: { mustContain: ["改革"], mustNotContain: ["剧透", "spoiler", "读到哪里", "阅读进度"] },
        tools: { requiredAny: ["search_book_text", "read_chapter"], forbidden: ["ask_user"], noErrors: true } },
      rubric: ["实际检索后文，并根据原文解释南方谈话推动改革；不因为用户停在早年或位置未知而避谈真实历史。"],
    })),
    defineAgentEvalScenario({
      id: "biography-later-life",
      description: "未读完的非虚构传记可以查后半生，不能默认使用小说围栏。",
      tags: ["spoiler", "retrieval", "forward", "book"],
      scope: { kind: "book", bookId: "eval-biography" },
      seed: { books: [{ id: "eval-biography", title: "Mara Evans: A Scientific Biography (Evaluation Text)", narrativity: "narrative", spoilerSensitive: false, status: "reading" }],
        chapters: { "eval-biography": [
          { title: "Childhood", text: "The biography opens with Mara Evans's childhood and schooling." },
          { title: "The laboratory years", text: "In 1981, Evans donated her 37 field notebooks to the university archive. This donation made the original observations available to later researchers." },
        ] } },
      turns: [{ text: "What did Evans donate in 1981, and why did it matter? Check this biography.", readingCursor: { chapterIndex: 0, visibleText: "The biography opens with Mara Evans's childhood and schooling." } }],
      expectation: { answer: { mustContain: ["37", "notebooks"], mustNotContain: ["spoiler"] },
        tools: { requiredAny: ["read_chapter", "search_book_text"], forbidden: ["ask_user"], noErrors: true } },
      rubric: ["Answers from the later chapter with the donation and its research benefit, without requesting permission or withholding the later life."],
    }),
  ],
};
