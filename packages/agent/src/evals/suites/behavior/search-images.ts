import { AppError } from "@read-aware/core";
import { WEB_PROVIDERS } from "../../../web/providers";
import type { WebPort } from "../../../web/types";
import { defineAgentEvalScenario } from "../../agent-harness";
import { assessmentFromChecks, combineAssessments, evaluateAgentTrace } from "../../assertions";
import type { AgentEvalObservation } from "../../types";

const source = "https://museum.example.org/roof";
const figure = "https://images.example.org/roof-section.png";
const unrelated = "https://images.example.org/sponsor.png";
const original = "The museum roof uses interlocking timber beams without metal fasteners. The roof-section.png figure shows the crossing beams and their joints. sponsor.png is a sponsor logo unrelated to the roof.";
type Mode = "match" | "empty" | "unrelated";

/** Actual provider adapters and host image IDs; replayed HTTP, real AgentThread/model. */
function web(provider: "tinyfish" | "tavily" | "brave", mode: Mode): WebPort {
  const images = mode === "empty" ? [] : mode === "unrelated" ? [{ url: unrelated, description: "Unrelated sponsor logo; NOT a roof diagram" }]
    : [{ url: figure, description: "Museum roof cross-section: interlocking timber beams and joints" }, { url: unrelated, description: "Unrelated sponsor logo" }];
  const client = WEB_PROVIDERS[provider].create("fixture-key", async (raw, init) => {
    const path = new URL(String(raw)).pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body));
    const text = mode === "match" ? original : "The museum roof uses interlocking timber beams without metal fasteners. No roof diagrams are available on this page. Any image is an unrelated sponsor logo.";
    if (provider === "tinyfish") {
      if (init?.method === "POST") return json({ results: [{ url: source, title: "Museum roof structure", text, image_links: images.map(i => i.url) }], errors: [] });
      return json({ results: [{ url: source, title: "Museum roof structure", snippet: text }] });
    }
    if (provider === "tavily") return json({ results: [{ url: source, title: "Museum roof structure", content: text, raw_content: text, images }], failed_results: [] });
    if (path.endsWith("/images/search")) return json({ type: "images", results: images.map(image => ({ url: source, title: image.description, properties: { url: image.url }, thumbnail: { src: `${image.url}?preview=1` } })) });
    if (path.endsWith("/context")) return json({ grounding: { generic: [{ url: source, title: "Museum roof structure", snippets: [text] }] }, sources: { [source]: { thumbnail: images[0] ? { src: images[0].url } : undefined } } });
    return json({ type: "search", web: { results: [{ url: source, title: "Museum roof structure", description: text, thumbnail: images[0] ? { src: images[0].url } : undefined }] } });
  });
  return { configured: () => true, search: client.search, fetch: (input, signal) => {
    if (input.url !== source) throw new AppError("search/fetch-failed", "Only the museum source is available");
    return client.fetch!(input, signal);
  } };
}
const shown = (observation: AgentEvalObservation) => observation.turns.flatMap(turn => turn.chunks.flatMap(chunk =>
  chunk.type === "reference" && chunk.reference.kind === "web-images" ? chunk.reference.images : []));

export const imageSearchScenarios = [
  ...(["brave", "tinyfish"] as const).flatMap(provider => ([false, true]).map(quick => defineAgentEvalScenario({
    id: `search-images-${provider}-${quick ? "quick-lookup" : "diagram"}`, description: `${provider}: ${quick ? "首轮请求图片，直接展示已有依据充分的结果，不重复抓取" : "非人物需求，模型选择并展示来源中的建筑结构图"}。`,
    scope: provider === "tinyfish" ? { kind: "book", bookId: "architecture" } : { kind: "global", threadId: "image-diagram" },
    seed: provider === "tinyfish" ? { books: [{ id: "architecture", title: "Architecture", author: "Museum", status: "reading", progressPercent: 10 }] } : {},
    tags: ["retrieval", "grounding", provider === "tinyfish" ? "book" : "global"],
    setup: ({ deps }) => { deps.web = web(provider, "match"); },
    turns: [{ text: quick ? "请联网找 museum.example.org 上的屋顶剖面图，展示一张对应的图，并用一句话说明是什么，不需要展开结构原理。" : "请联网查 museum.example.org 上的博物馆木构屋顶资料，解释梁是怎么连接的。我想直观看懂这种结构，适合的话请配图。" }],
    evaluate: observation => combineAssessments(evaluateAgentTrace(observation, {
      tools: { required: ["web_search", "present_web_images"], ...(quick ? { forbidden: ["web_fetch"] } : {}), noErrors: true, maxCalls: quick ? 2 : 6 },
      answer: { mustNotContain: ["![", "fixture-key"] },
    }), assessmentFromChecks([{ id: "images.correct-source", category: "policy", passed: shown(observation).length === 1 && shown(observation)[0]?.url === figure && shown(observation)[0]?.sourceUrl === source,
      message: "one relevant structure diagram reaches the UI reference stream, without the sponsor logo" }])),
    rubric: [quick ? "首轮搜索请求图片，直接展示一张有来源的屋顶剖面图，并简短介绍；不重复抓取或展示赞助商 logo，不声称检查过像素。" : "回答梁的连接方式并展示对应结构图，图像带来源；不把赞助商 logo 当建筑图，不声称检查过图片像素。已有摘录足够时不重复抓取；需要更多证据时仍应读取原文。"],
  }))),
  ...(["empty", "unrelated"] as const).map(mode => defineAgentEvalScenario({
    id: `search-images-${mode}`, description: `Tavily: ${mode === "empty" ? "没有图片" : "只有无关图片"}时不硬凑图。`,
    scope: { kind: "global", threadId: `image-${mode}` }, tags: ["retrieval", "honesty", "global"],
    setup: ({ deps }) => { deps.web = web("tavily", mode); },
    turns: [{ text: `请只读 ${source}，解释这个屋顶的木梁连接方式；有对应结构图就展示，没有就用文字说清楚。不要从别处找图。` }],
    evaluate: observation => combineAssessments(evaluateAgentTrace(observation, {
      tools: { required: ["web_fetch"], forbidden: ["web_search", "present_web_images"], noErrors: true, maxCalls: 2 },
      answer: { mustNotContain: ["![", figure, unrelated] },
    }), assessmentFromChecks([{ id: "images.no-substitution", category: "policy", passed: shown(observation).length === 0, message: "no fabricated or unrelated image card" }])),
    rubric: ["解释木梁互相咬合、无需金属紧固件，并如实说明没有对应结构图；不把 logo 冒充图，不因没有图片放弃回答。"],
  })),
  defineAgentEvalScenario({ id: "search-images-text-only", description: "即使来源有图，也遵守仅文字要求。",
    scope: { kind: "global", threadId: "image-text" }, tags: ["retrieval", "control", "global"],
    setup: ({ deps }) => { deps.web = web("tavily", "match"); },
    turns: [{ text: `请读 ${source}，仅用文字解释屋顶结构，不要配图。` }],
    expectation: { tools: { required: ["web_fetch"], forbidden: ["present_web_images", "web_search"], noErrors: true, maxCalls: 2 }, answer: { mustNotContain: ["!["] } },
    rubric: ["只用文字准确解释木梁连接方式，不展示图片。"],
  }),
  defineAgentEvalScenario({ id: "search-images-multiple-complementary", description: "多个互补图像一起展示，不停在第一张、不展示同图的其他尺寸或站点图标。",
    scope: { kind: "global", threadId: "multiple-figures" }, tags: ["retrieval", "grounding", "global"],
    setup: ({ deps }) => {
      const client = WEB_PROVIDERS.tinyfish.create("fixture-key", async () => new Response(JSON.stringify({ results: [{ url: source, title: "Museum roof structure",
        text: "The roof plan roof-plan.png shows the overall radial beam arrangement. The separate roof-section.png diagram shows how the joints interlock, without metal fasteners. These are complementary views of the same roof, not alternative sizes of one image.",
        image_links: ["https://en.wikipedia.org/static/images/icons/wikipedia.png", figure, "https://images.example.org/roof-plan.png"],
      }], errors: [] })));
      deps.web = { configured: () => true, search: client.search, fetch: client.fetch! };
    },
    turns: [{ text: `请读 ${source}，我想直观看懂屋顶的整体布局和局部接头有什么关系，适合的话配图说明。` }],
    evaluate: observation => combineAssessments(evaluateAgentTrace(observation, {
      tools: { required: ["web_fetch", "present_web_images"], forbidden: ["web_search"], noErrors: true, maxCalls: 4 },
    }), assessmentFromChecks([{ id: "images.complementary", category: "tool",
      passed: shown(observation).length === 2 && [figure, "https://images.example.org/roof-plan.png"].every(url => shown(observation).some(image => image.url === url)),
      message: "Both relevant complementary figures are presented, without a site icon" }])),
    rubric: ["用布局图和剖面图分别解释整体与局部，图和说明有来源；不把站点图标当建筑图，也不声称看过未输入模型的像素。"],
  }),
];
