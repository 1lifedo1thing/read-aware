import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { usePluginUriPrompt } from "./usePluginUriPrompt";
import { pluginUriRegistry, pendingPluginUrisAtom, receivePluginUris } from "../lib/plugin-uri";
import { pluginsReadyAtom, pluginDialogAtom } from "../state/plugin-store";

test("cold-start links await plugin initialization and explicit acceptance; replacements cannot inherit approval", async () => {
  const dom=new JSDOM("<!doctype html><div id='root'></div>");
  const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true};
  const saved=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const root=createRoot(dom.window.document.getElementById("root")!),store=getDefaultStore();let state!:ReturnType<typeof usePluginUriPrompt>,calls=0;
  function Harness(){state=usePluginUriPrompt();return null;}
  const registrations: {dispose():void}[]=[];
  const register=()=>{const r=pluginUriRegistry.register({id:"open",key:"uri-ui:open",pluginId:"uri-ui",pluginName:"URI UI",open:request=>{calls++;expect(request.parameters).toEqual([{key:"x",value:"2"}]);return {view:{kind:"detail",title:"Approved",content:[]}};}});registrations.push(r);return r;};
  try {
    store.set(pluginsReadyAtom,false);store.set(pendingPluginUrisAtom,[]);store.set(pluginDialogAtom,null);
    receivePluginUris(["readaware://plugin/uri-ui/open?x=1"]);
    await act(async()=>{root.render(createElement(Harness));});expect(state.prompt).toBeNull();expect(calls).toBe(0);
    await act(async()=>{register();store.set(pluginsReadyAtom,true);});expect(state.enabled).toBe(true);expect(calls).toBe(0);
    await act(async()=>{register();});expect(state.enabled).toBe(false);
    await act(async()=>{state.open();});expect(calls).toBe(0);
    await act(async()=>{state.close();receivePluginUris(["readaware://plugin/uri-ui/open?x=2"]);});expect(state.enabled).toBe(true);
    await act(async()=>{state.open();});expect(calls).toBe(1);expect(store.get(pluginDialogAtom)?.view?.title).toBe("Approved");expect(store.get(pendingPluginUrisAtom)).toEqual([]);
  } finally {
    await act(async()=>{root.unmount();});for(const r of registrations)r.dispose();store.set(pluginDialogAtom,null);store.set(pendingPluginUrisAtom,[]);store.set(pluginsReadyAtom,false);
    dom.window.close();for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
