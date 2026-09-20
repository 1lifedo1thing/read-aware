import { useEffect, useRef, useState } from "react";
import { WEB_PROVIDERS, isWebProviderId } from "@read-aware/agent";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { useReactiveSetting } from "../../../hooks/useReactiveSetting";
import { flushLocalKV } from "../../../platform/local-store";
import { flushSecretWrites } from "../../../platform/secret-store";
import { appHttpFetch } from "../../../platform/http-client";
import { createLogger } from "../../../platform/logger";
import { getSearchApiKey, getSearchConfig, saveSearchConfig, type SearchConfig } from "../../ai/lib/search-config";

const log = createLogger("search-settings");
export function useSearchConfig() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const [initial] = useState(() => {
    let readError: string | null = null;
    const config = getSearchConfig(error => { readError = describeError(error).body; });
    return { config, readError };
  });
  const [config, setConfig] = useState(initial.config);
  const [readError, setReadError] = useState(initial.readError);
  const [revision, setRevision] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const { flush } = useReactiveSetting({ value: config, revision, persist: saveSearchConfig });
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const change = (next: Partial<SearchConfig>) => {
    active.current?.abort(); active.current = null;
    setTesting(false); setResult(null); setReadError(null);
    setConfig(value => ({ ...value, ...next })); setRevision(value => value + 1);
  };
  const changeProvider = (value: string) => {
    if (!isWebProviderId(value)) return;
    flush();
    setShowKey(false);
    change({ provider: value, apiKey: getSearchApiKey(value) });
  };
  const test = async () => {
    if (active.current || !config.apiKey.trim()) return;
    flush();
    const controller = new AbortController(); active.current = controller;
    setTesting(true); setResult(null);
    try {
      await Promise.all([flushLocalKV(), flushSecretWrites()]);
      controller.signal.throwIfAborted();
      const provider = WEB_PROVIDERS[config.provider];
      const client = provider.create(config.apiKey, appHttpFetch);
      await client.search({ query: "Example Domain", domains: ["example.com"], limit: 1 }, controller.signal);
      controller.signal.throwIfAborted();
      if (provider.supportsFetch) {
        if (!client.fetch) throw new Error("Provider lacks its declared page reading capability");
        await client.fetch({ url: provider.connectionTestUrl ?? "https://example.com", maxChars: 500, fresh: true }, controller.signal);
      }
      if (active.current === controller) setResult({ success: true, message: t(provider.supportsFetch ? "search.testSuccess" : "search.testSearchSuccess") });
    } catch (error) {
      if (!controller.signal.aborted) {
        log.error("Search connection test failed", error);
        const message = describeError(error).body;
        if (active.current === controller) {
          setResult({ success: false, message });
          toast({ description: message, variant: "destructive" });
        }
      }
    } finally {
      if (active.current === controller) { active.current = null; setTesting(false); }
    }
  };
  return { config, change, changeProvider, flush, showKey, setShowKey, testing, result, readError, test };
}
