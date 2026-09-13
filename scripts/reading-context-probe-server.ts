/** Loopback-only request evidence for isolated reading privacy and streaming UI probes. */
const followProbe = process.env.READAWARE_STREAMING_PROBE === "1";
const configProbe = process.env.READAWARE_CONFIG_PROBE === "1";
const records: Array<{ selected: boolean; viewport: boolean; grounding: boolean; held: boolean; cancelled: boolean; paragraphs?: number; model?: unknown; maxOutputTokens?: unknown; reasoningEffort?: unknown }> = [];
const releases = new Set<() => void>();
const advances = new Set<() => void>();
const encoder = new TextEncoder();
let hold = false;
Bun.serve({
  hostname: "127.0.0.1", port: 19843,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/state") return Response.json(records);
    if (path === "/next" && followProbe) { for (const advance of [...advances]) advance(); return new Response("ok"); }
    if (path === "/hold") { hold = true; return new Response("ok"); }
    if (path === "/release") {
      hold = false;
      for (const release of [...releases]) release();
      return new Response("ok");
    }
    if (path !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
    const body = await request.json() as { messages: unknown[]; model?: unknown; max_tokens?: unknown; max_completion_tokens?: unknown; reasoning_effort?: unknown };
    const input = JSON.stringify(body.messages);
    const record = { selected: input.includes("SELECTION_MARKER_947"), viewport: input.includes("VIEWPORT_MARKER_628"),
      grounding: input.includes("<grounding_context>"), held: hold || followProbe, cancelled: false, ...(followProbe ? { paragraphs: 0 } : {}),
      ...(configProbe ? { model: body.model, maxOutputTokens: body.max_completion_tokens ?? body.max_tokens, reasoningEffort: body.reasoning_effort } : {}) };
    records.push(record);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let release!: () => void;
    let advance!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        const text = (content: string) => send({ id: "context-probe", object: "chat.completion.chunk", created: 1, model: "privacy-probe",
          choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
        advance = () => {
          if (record.cancelled) return;
          for (let i = 0; i < 8; i++) {
            record.paragraphs = (record.paragraphs ?? 0) + 1;
            text(`Paragraph ${record.paragraphs}: This synthetic response checks native transcript scrolling. The reader can pause following, inspect earlier text, and return to the newest passage.\n\n`);
          }
        };
        release = () => {
          if (heartbeat) clearInterval(heartbeat);
          releases.delete(release);
          advances.delete(advance);
          if (record.cancelled) return;
          if (!followProbe) text("Controlled reading privacy answer.");
          send({ id: "context-probe", object: "chat.completion.chunk", created: 1, model: "privacy-probe",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
          controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
        };
        if (hold || followProbe) {
          releases.add(release);
          if (followProbe) advances.add(advance);
          heartbeat = setInterval(() => controller.enqueue(encoder.encode(": waiting\n\n")), 100);
        } else release();
      },
      cancel() { record.cancelled = true; if (heartbeat) clearInterval(heartbeat); releases.delete(release); advances.delete(advance); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  },
});
console.log("Reading context probe: http://127.0.0.1:19843");
