import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { pluginsReadyAtom, pluginDialogAtom } from "../state/plugin-store";
import { actionEnabled } from "../lib/plugin-action-state";
import { runPluginContribution } from "../lib/run-result";
import { dismissPluginUri, findPluginUriHandler, pendingPluginUrisAtom, pluginUriRegistry, receivePluginUris,
  type PendingPluginUri, type RegisteredUriHandler } from "../lib/plugin-uri";

/** External receipt never invokes a plugin. Confirmation freezes the exact
 * registered callback; replacement cannot inherit an older link approval. */
export function usePluginUriPrompt() {
  const ready=useAtomValue(pluginsReadyAtom), pending=useAtomValue(pendingPluginUrisAtom);
  const registrations=useAtomValue(pluginUriRegistry.atom), dialog=useAtomValue(pluginDialogAtom);
  const [prompt,setPrompt]=useState<{link:PendingPluginUri;handler:RegisteredUriHandler|null}|null>(null);
  useEffect(()=>{
    if(!isTauri())return;
    let disposed=false, stop:(()=>void)|undefined;
    void (async()=>{
      const unlisten=await onOpenUrl(urls=>{if(!disposed)receivePluginUris(urls);});
      if(disposed){unlisten();return;}stop=unlisten;
      try {const urls=await getCurrent();if(!disposed&&urls)receivePluginUris(urls);}
      catch(error){unlisten();stop=undefined;throw error;}
    })().catch(error=>createLogger("plugins").warn("Plugin deep-link subscription failed",error));
    return()=>{disposed=true;stop?.();};
  },[]);
  useEffect(()=>{
    if(ready&&!dialog&&!prompt&&pending[0])setPrompt({link:pending[0],handler:findPluginUriHandler(pending[0])});
  },[ready,dialog,prompt,pending]);
  const close=()=>{if(prompt)dismissPluginUri(prompt.link.id);setPrompt(null);};
  const current=prompt&&registrations.find(item=>item.pluginId===prompt.link.pluginId&&item.id===prompt.link.handlerId);
  const enabled=!!current&&current.open===prompt?.handler?.open&&actionEnabled(current);
  const open=()=>{
    if(!prompt?.handler||!enabled)return;
    const {handler,link}=prompt;close();
    void runPluginContribution(handler.pluginId,handler.pluginName,()=>handler.open(structuredClone(link.request)),{presentation:"dialog",owner:handler.open});
  };
  return {prompt,visible:!!prompt&&!dialog,enabled,close,open};
}
