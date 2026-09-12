import { expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { buildPluginContext } from "../runtime/plugin-context";
import { parsePluginUri, receivePluginUris, pendingPluginUrisAtom, dismissPluginUri, findPluginUriHandler } from "./plugin-uri";

test("URI parser isolates plugin routes from authentication, system protocols and malformed authority", () => {
  expect(parsePluginUri("readaware://plugin/rss-reader/subscribe?url=https%3A%2F%2Fexample.com%2Ffeed")).toMatchObject({pluginId:"rss-reader",handlerId:"subscribe",request:{parameters:[{key:"url",value:"https://example.com/feed"}]}});
  for(const uri of ["readaware://sync/login/PRIVATE","readaware://billing/success","file:///tmp/file","https://plugin/a/b",
    "readaware://user@plugin/a/b","readaware://plugin:7/a/b","readaware://plugin/a/../b","readaware://plugin/%61/b",
    "readaware://plugin/a/b#fragment","readaware://plugin/a/b?x=%00","readaware://plugin/a/b?x="+"x".repeat(2049),
    "readaware://plugin/a/b?"+Array.from({length:25},(_,i)=>`a${i}=1`).join("&")])expect(parsePluginUri(uri)).toBeNull();
});

test("link intake is bounded and inert; registration is staged, owned and retired by exact identity", async () => {
  const store=getDefaultStore();store.set(pendingPluginUrisAtom,[]);
  const {context,lifecycle}=buildPluginContext({id:"uri-owner",name:"Owner",version:"1",schemaVersion:1,requires:{}},"1",[]);
  for(const value of [null,{id:undefined,open(){}},{id:1,open(){}},{id:"ok",state:null,open(){}}])expect(()=>context.contributions.uriHandlers.register(value as never)).toThrow();
  let calls=0;
  const input={id:"entry",open:()=>{calls++;return {toast:"Opened"};}};
  const registration=context.contributions.uriHandlers.register(input);input.id="changed";
  const uri="readaware://plugin/uri-owner/entry?x=1",parsed=parsePluginUri(uri)!;
  receivePluginUris([uri,uri],100);expect(calls).toBe(0);expect(store.get(pendingPluginUrisAtom)).toHaveLength(1);
  expect(findPluginUriHandler(parsed)).toBeNull();lifecycle.promote();
  const handler=findPluginUriHandler(parsed)!;expect(handler.id).toBe("entry");expect(handler.pluginId).toBe("uri-owner");
  await handler.open(parsed.request);expect(calls).toBe(1);
  await registration.updateState({revision:1,visible:true,enabled:false});expect(()=>handler.open(parsed.request)).toThrow();
  context.contributions.uriHandlers.register({id:"entry",open:()=>null});expect(()=>handler.open(parsed.request)).toThrow();
  receivePluginUris(Array.from({length:20},(_,i)=>`readaware://plugin/uri-owner/entry?x=${i+2}`),101);expect(store.get(pendingPluginUrisAtom)).toHaveLength(8);
  for(const item of store.get(pendingPluginUrisAtom))dismissPluginUri(item.id);
  lifecycle.stop();await lifecycle.drainCleanups();expect(findPluginUriHandler(parsed)).toBeNull();expect(calls).toBe(1);
});
