import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";
import { localKV, flushLocalKV } from "../src/platform/local-store";
import { getVirtualBookBinding, recoverVirtualBookBindings } from "../src/features/plugins/lib/virtual-books";
import type { EventRowWire } from "../src/platform/domain-events";

test("public virtual creation waits for its atomic receipt, coalesces duplicate binding calls, isolates owners and recovers orphan metadata", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const key = "read-aware-virtual-books", kv = new Map<string,string>();
  const books = new Map<string,{id:string;title:string;format:string;coverStatus:string}>();
  let reject = false, creates = 0, release: (()=>void) | undefined;
  let gate: Promise<void> | undefined;
  Object.defineProperty(globalThis,"window",{configurable:true,value:{__TAURI_INTERNALS__:{invoke:async(command:string,args:Record<string,unknown>={})=>{
    if(command==="local_device_get")return {deviceId:"binding-test",lastHlcWallMs:0,lastHlcCounter:0};
    if(command==="set_kv"){kv.set(args.key as string,args.value as string);return;}
    if(command==="delete_kv"){kv.delete(args.key as string);return;}
    if(command==="library_get_book")return books.get(args.id as string)??null;
    if(command==="library_load")return [...books.values()];
    if(command==="reading_time_load")return {totals:[],daily:[],hourly:[]};
    if(command==="virtual_book_create"){
      creates++;await gate;if(reject)throw new AppError("db/locked","Atomic creation refused");
      expect(args.expectedRegistry).toBe(kv.get(key)??null);
      const events=args.events as EventRowWire[];
      const event=events[0]!;expect(event.type).toBe("book.imported");
      books.set(args.bookId as string,{id:args.bookId as string,title:(event.payload as {title:string}).title,format:"virtual",coverStatus:"none"});
      kv.set(key,args.replacementRegistry as string);return {appended:2,applied:2};
    }
    if(command==="commit_events"){
      const events=args.events as EventRowWire[];
      for(const event of events){expect(event.type).toBe("book.metadataEdited");const data=event.payload as {bookId:string;title:string};books.get(data.bookId)!.title=data.title;}
      return {appended:events.length,applied:events.length};
    }
    if(command==="virtual_book_prune"){
      if(reject)throw new AppError("db/locked","Recovery refused");
      expect(args.expectedRegistry).toBe(kv.get(key)??null);
      for(const id of args.bookIds as string[])expect(books.has(id)).toBe(false);
      kv.set(key,args.replacementRegistry as string);return;
    }
    throw Error(`Unexpected IPC ${command}`);
  }}}});
  const saved = localKV.getItem(key);
  const make=(id:string)=>buildPluginContext({id,name:id,version:"1",schemaVersion:1,requires:{},permissions:["library:write"]},"1",[]);
  const plugin=make("binding-owner"),other=make("binding-other");
  try {
    localKV.removeItem(key);await flushLocalKV(); plugin.lifecycle.promote();other.lifecycle.promote();
    const api=plugin.context.domains.library!.commands!.books;
    gate=new Promise<void>(resolve=>{release=resolve;});
    let settled=false;
    const first=api.addVirtualBook({providerId:"feed",key:"one",title:"First"}).then(value=>{settled=true;return value;});
    const second=api.addVirtualBook({providerId:"feed",key:"one",title:"Updated"});
    await Bun.sleep(0);expect(creates).toBe(1);expect(settled).toBe(false);expect(books.size).toBe(0);
    release!();const [a,b]=await Promise.all([first,second]);expect(a.id).toBe(b.id);expect(b.title).toBe("Updated");expect(books.size).toBe(1);
    expect(getVirtualBookBinding(a.id)).toEqual({pluginId:"binding-owner",providerId:"feed",key:"one"});
    await expect(api.removeVirtualBook({providerId:"feed",key:"one",expectedBookId:"old-book"})).rejects.toMatchObject({code:"reader/superseded"});
    expect(books.has(a.id)).toBe(true);
    const foreign=await other.context.domains.library!.commands!.books.addVirtualBook({providerId:"feed",key:"one",title:"Foreign"});
    expect(foreign.id).not.toBe(a.id);
    reject=true;
    await expect(api.addVirtualBook({providerId:"feed",key:"failed",title:"Failure"})).rejects.toMatchObject({code:"db/locked"});
    expect(books.size).toBe(2);expect(Object.keys(JSON.parse(localKV.getItem(key)!))).toHaveLength(2);
    reject=false;
    const registry=JSON.parse(localKV.getItem(key)!);registry.orphan={pluginId:"binding-owner",providerId:"feed",key:"orphan"};
    await localKV.setItemAsync(key,JSON.stringify(registry));
    reject=true;await expect(recoverVirtualBookBindings(async()=>[...books.values()])).rejects.toMatchObject({code:"db/locked"});expect(getVirtualBookBinding("orphan")).not.toBeNull();
    reject=false;expect(await recoverVirtualBookBindings(async()=>[...books.values()])).toBe(1);expect(getVirtualBookBinding("orphan")).toBeNull();expect(getVirtualBookBinding(foreign.id)?.pluginId).toBe("binding-other");
    // Once native dispatch starts, retirement drains it and preserves its real receipt.
    gate=new Promise<void>(resolve=>{release=resolve;});
    const accepted=api.addVirtualBook({providerId:"feed",key:"retiring",title:"Accepted"});await Bun.sleep(0);
    plugin.lifecycle.stop();let drained=false;const drain=plugin.lifecycle.drainStorageWrites().then(()=>{drained=true;});
    await Bun.sleep(0);expect(drained).toBe(false);release!();const receipt=await accepted;await drain;
    expect(books.has(receipt.id)).toBe(true);expect(getVirtualBookBinding(receipt.id)?.key).toBe("retiring");
  } finally {
    release?.();plugin.lifecycle.stop();other.lifecycle.stop();await Promise.allSettled([plugin.lifecycle.drainStorageWrites(),other.lifecycle.drainStorageWrites()]);
    if(saved===null)localKV.removeItem(key);else localKV.setItem(key,saved);await flushLocalKV();
    if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window");
  }
});
