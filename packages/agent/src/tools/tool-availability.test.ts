import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ReaderToolContext } from "../ports";
import { buildAgentTools, createAgentTurnState } from "./registry";

const ready = (): ReaderToolContext => ({ bookId:"book",session:true,ready:true,selection:true,controls:true,panels:true,modes:true,playback:true,imageBookId:"book" });
test("host discovery filters ambient failures, preserves recovery/queries and explains missing tools without leaking reader text", async () => {
  const {deps}=createInMemoryDeps();let context=ready();deps.reader.toolContext=()=>context;
  const scope={kind:"book",bookId:"book"} as const;
  const initial=buildAgentTools(scope,deps), stale=initial.find(tool=>tool.name==="focus_reader")!;
  expect(initial.some(tool=>tool.name==="control_read_aloud")).toBe(true);
  context={...context,ready:false,selection:false};
  let tools=buildAgentTools(scope,deps), names=tools.map(tool=>tool.name);
  expect(names).not.toContain("focus_reader");expect(names).toContain("navigate_reading");expect(names).toContain("get_reading_session");expect(names).toContain("open_book");
  const result=await tools.find(tool=>tool.name==="get_host_capabilities")!.execute("catalog",{catalog:"tools",includeUnavailable:true,query:"focus_reader"});
  expect(JSON.parse((result.content[0] as {text:string}).text).items).toMatchObject([{name:"focus_reader",registered:false,availability:{state:"unavailable",reason:"reader-not-ready"}}]);
  await expect(stale.execute("stale",{target:"content"})).rejects.toMatchObject({code:"ui/unavailable"});
  context={...ready(),bookId:"foreign",imageBookId:"foreign"};tools=buildAgentTools(scope,deps);names=tools.map(tool=>tool.name);
  expect(names).not.toContain("navigate_reading");expect(names).not.toContain("control_reader_image");expect(names).toContain("get_reader_image");
  context=ready();expect(buildAgentTools(scope,deps).some(tool=>tool.name==="focus_reader")).toBe(true);
});

test("selection, mode, image and controls gate independently; failed metadata does not block pure queries", () => {
  const {deps}=createInMemoryDeps();deps.reader.toolContext=()=>({...ready(),selection:false,controls:false,panels:false,modes:false,playback:false,imageBookId:null});
  const names=buildAgentTools({kind:"global",threadId:"global"},deps).map(tool=>tool.name);
  for(const name of ["explain_selection","define_term","translate_selection","set_reader_controls","set_reader_panel","configure_reading_mode","control_read_aloud","control_reader_image"])expect(names).not.toContain(name);
  expect(names).toContain("get_reading_session");expect(names).toContain("summarize_chapter");expect(names).toContain("list_books");
  deps.reader.toolContext=()=>{throw Error("PRIVATE_RUNTIME_ERROR");};
  const failed=buildAgentTools({kind:"global",threadId:"global"},deps);
  expect(failed.some(tool=>tool.name==="focus_reader")).toBe(false);expect(failed.some(tool=>tool.name==="list_books")).toBe(true);
});


test("turn-captured selection privacy is not widened by later preferences", () => {
  const {deps}=createInMemoryDeps();deps.reader.toolContext=ready;
  const state=createAgentTurnState();state.readingContextPermissions={selection:false,surrounding:true};
  const names=buildAgentTools({kind:"global",threadId:"private"},deps,state).map(tool=>tool.name);
  expect(names).not.toContain("explain_selection");expect(names).toContain("get_reading_session");
});
