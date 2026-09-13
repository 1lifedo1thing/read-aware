/** Loopback-only request evidence for isolated reading privacy and streaming UI probes. */
const followProbe = process.env.READAWARE_STREAMING_PROBE === "1";
const configProbe = process.env.READAWARE_CONFIG_PROBE === "1";
const records: Array<{ selected: boolean; viewport: boolean; grounding: boolean; held: boolean; cancelled: boolean; paragraphs?: number; model?: unknown; maxOutputTokens?: unknown; reasoningEffort?: unknown; api?: string; toolResults?: number }> = [];
const releases = new Set<() => void>();
const advances = new Set<() => void>();
const encoder = new TextEncoder();
let hold = false;
let failNext = false;
Bun.serve({
  hostname: "127.0.0.1", port: 19843,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/state") return Response.json(records);
    if (path === "/next" && followProbe) { for (const advance of [...advances]) advance(); return new Response("ok"); }
    if (path === "/hold") { hold = true; return new Response("ok"); }
    if (path === "/fail-next" && configProbe) { failNext = true; return new Response("ok"); }
    if (path === "/release") {
      hold = false;
      for (const release of [...releases]) release();
      return new Response("ok");
    }
    if (path === "/v1/responses" && configProbe) {
      const body = await request.json() as { model: string; input: Array<{ type?: string }>; tools?: Array<{ name?: string }>; max_output_tokens?: number; reasoning?: { effort?: string } };
      const input = JSON.stringify(body.input);
      const toolResults = body.input.filter(item => item.type === "function_call_output").length;
      const record = { selected: input.includes("SELECTION_MARKER_947"), viewport: input.includes("VIEWPORT_MARKER_628"), grounding: input.includes("<grounding_context>"), held: hold, cancelled: false, api: "responses", model: body.model, maxOutputTokens: body.max_output_tokens, reasoningEffort: body.reasoning?.effort, toolResults };
      records.push(record);
      const fail = failNext; failNext = false;
      const id = `resp_probe_${records.length}`;
      const callTool = !toolResults && body.tools?.some(tool => tool.name === "get_toc");
      const item = callTool
        ? { id: `fc_${id}`, type: "function_call", call_id: `call_${id}`, name: "get_toc", arguments: "{}", status: "completed" }
        : { id: `msg_${id}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Responses native protocol probe completed.", annotations: [] }] };
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let release!: () => void;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let sequence = 0;
          const send = (type: string, fields: object) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`));
          send("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
          release = () => {
            if (heartbeat) clearInterval(heartbeat); releases.delete(release);
            if (record.cancelled) return;
            if (fail) {
              send("response.failed", { response: { id, status: "failed", error: { code: "server_error", message: "Controlled Responses failure" } } });
            } else {
              send("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", ...(callTool ? { arguments: "" } : { content: [] }) } });
              if (callTool) send("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: "{}" });
              else send("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: "Responses native protocol probe completed." });
              send("response.output_item.done", { output_index: 0, item });
              send("response.completed", { response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
            }
            controller.close();
          };
          if (hold) { releases.add(release); heartbeat = setInterval(() => controller.enqueue(encoder.encode(": waiting\n\n")), 100); }
          else release();
        },
        cancel() { record.cancelled = true; if (heartbeat) clearInterval(heartbeat); releases.delete(release); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
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
