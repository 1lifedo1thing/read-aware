/** Disposable loopback request recorder for real ChatPanel context acceptance. */
const records: Array<Record<string, unknown>> = [];
Bun.serve({ hostname: "127.0.0.1", port: 19849, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/state") return Response.json(records);
  if (path !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
  const body = await request.json() as Record<string, unknown>;
  records.push({ at: new Date().toISOString(), body });
  const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: `goals88_${records.length}`, object: "chat.completion.chunk", created: 1, model: "goals-context-probe", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "Controlled reading-goal context request recorded." }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
} });
console.log("Reading Goals request recorder: http://127.0.0.1:19849");
