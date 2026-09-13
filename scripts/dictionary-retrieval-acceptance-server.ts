/** Loopback-only AI12/CON01 fixture; plans contain synthetic public-tool inputs. */
type Step = { name: string; args: Record<string, unknown> };
type Input = { role?: string; type?: string; output?: unknown };
const allowed = new Set(["plugin_dictionary_save_word", "plugin_dictionary_retrieve_saved_vocabulary", "get_host_capabilities"]);
let plan: Step[] = [], index = 0, lastResult: Record<string, unknown> = {};
const records: Array<Record<string, unknown>> = [];
const encoder = new TextEncoder();
Bun.serve({ hostname: "127.0.0.1", port: 19843, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/state") return Response.json({ index, remaining: plan.length - index, records });
  if (path === "/plan" && request.method === "POST") {
    const candidate = await request.json() as Step[];
    if (!Array.isArray(candidate) || candidate.length > 16 || candidate.some(step => !allowed.has(step.name) || !step.args || typeof step.args !== "object")) return new Response("Invalid plan", { status: 400 });
    plan = candidate; index = 0; lastResult = {}; return Response.json({ steps: plan.length });
  }
  if (path !== "/v1/responses") return new Response("Not found", { status: 404 });
  const body = await request.json() as { input: Input[]; tools?: Array<{ name?: string }> };
  const output = body.input.findLast(item => item.type === "function_call_output");
  if (output) {
    try { lastResult = JSON.parse(String(output.output)); } catch { lastResult = { error: String(output.output).slice(0, 1200) }; }
  }
  const step = plan[index++];
  if (!step) index = plan.length;
  const args = step ? Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key, typeof value === "string" && value.startsWith("$last.") ? lastResult[value.slice(6)] : value])) : {};
  records.push({ step: step?.name ?? "answer", args, previousResult: output ? lastResult : null, dictionaryTools: body.tools?.map(tool => tool.name).filter(name => name?.startsWith("plugin_dictionary_")) });
  const id = `dictionary86_${records.length}`, serialized = JSON.stringify(args);
  const answer = "Controlled Dictionary retrieval and capability round completed.";
  const item = step
    ? { id: `fc_${id}`, type: "function_call", call_id: `call_${id}`, name: step.name, arguments: serialized, status: "completed" }
    : { id: `msg_${id}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: answer, annotations: [] }] };
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    let sequence = 0;
    const send = (type: string, fields: object) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`));
    send("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
    send("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", ...(step ? { arguments: "" } : { content: [] }) } });
    if (step) send("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: serialized });
    else send("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: answer });
    send("response.output_item.done", { output_index: 0, item });
    send("response.completed", { response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
    controller.close();
  } });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
} });
console.log("Dictionary retrieval acceptance: http://127.0.0.1:19843");
