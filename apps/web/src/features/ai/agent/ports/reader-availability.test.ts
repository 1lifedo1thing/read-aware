import { expect, spyOn, test } from "bun:test";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { createReaderPort } from "./reader-port";

test("product reader port publishes ambient metadata from the current controller without content or locators", () => {
  const current=readingRuntime.snapshot();
  const snapshot=spyOn(readingRuntime,"snapshot").mockReturnValue({...current,bookId:"book",sessionId:"session",status:"ready",visibleText:"PRIVATE",location:{bookId:"book",contentVersion:"version",cfi:"PRIVATE_CFI"}});
  try {
    const reader=createReaderPort();const context=reader.toolContext!();
    expect(context).toMatchObject({bookId:"book",session:true,ready:true});
    expect(JSON.stringify(context)).not.toContain("PRIVATE");expect(context).not.toHaveProperty("sessionId");
    snapshot.mockReturnValue({...current,bookId:null,sessionId:null,status:"idle"});
    expect(reader.toolContext!()).toMatchObject({bookId:null,session:false,ready:false});
  } finally { snapshot.mockRestore(); }
});
