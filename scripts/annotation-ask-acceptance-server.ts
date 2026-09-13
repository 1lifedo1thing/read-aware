/** Isolated ANN06 chat approval fixture. Synthetic IDs only; no prompt/credential logging. */
const records: Array<{ action: string; target?: string; result?: string }> = [];
const encoder = new TextEncoder();
Bun.serve({
  hostname: "127.0.0.1", port: 19843,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/state") return Response.json(records);
    if (path !== "/v1/responses") return new Response("Not found", { status: 404 });
    const body = await request.json() as { input: Array<{ role?: string; type?: string; output?: unknown }>; tools?: Array<{ name?: string }> };
    const lastUser = body.input.findLastIndex(item => item.role === "user");
    const latest = JSON.stringify(body.input[lastUser] ?? {});
    const target = latest.match(/ANN81_DELETE:([a-f0-9-]{36})/)?.[1];
    const output = body.input.slice(lastUser + 1).findLast(item => item.type === "function_call_output");
    const callTool = !!target && !output && body.tools?.some(tool => tool.name === "delete_annotation");
    records.push({ action: callTool ? "delete_annotation" : "answer", ...(target ? { target } : {}), ...(output ? { result: String(output.output).slice(0, 1000) } : {}) });
    const id = `ann81_${records.length}`;
    const args = JSON.stringify({ annotationId: target });
    const answer = "Controlled annotation approval round completed.";
    const item = callTool
      ? { id: `fc_${id}`, type: "function_call", call_id: `call_${id}`, name: "delete_annotation", arguments: args, status: "completed" }
      : { id: `msg_${id}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: answer, annotations: [] }] };
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      let sequence = 0;
      const send = (type: string, fields: object) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`));
      send("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
      send("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", ...(callTool ? { arguments: "" } : { content: [] }) } });
      if (callTool) send("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: args });
      else send("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: answer });
      send("response.output_item.done", { output_index: 0, item });
      send("response.completed", { response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
      controller.close();
    } });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  },
});
console.log("Annotation ask acceptance: http://127.0.0.1:19843");
