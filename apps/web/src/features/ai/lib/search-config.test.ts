import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { WEB_PROVIDERS, type WebProvider } from "@read-aware/agent";
import { hydrateSecrets, deleteSecret, getSecret, setSecret } from "../../../platform/secret-store";
import { agentWeb } from "../agent/ports/web-port";
import { getSearchConfig, saveSearchConfig, SEARCH_CONFIG_KEY } from "./search-config";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
beforeAll(() => hydrateSecrets());
beforeEach(() => { storage.clear(); deleteSecret("ai-api-key.search.tinyfish"); });
afterEach(() => { deleteSecret("ai-api-key.search.tinyfish"); deleteSecret("ai-api-key.search.fixture"); });

test("search defaults off and persists its key separately from model credentials", () => {
  expect(getSearchConfig()).toEqual({ provider: "tinyfish", enabled: false, apiKey: "" });
  const previous = getSecret("ai-api-key.openai");
  try {
    setSecret("ai-api-key.openai", "model-secret");
    saveSearchConfig({ provider: "tinyfish", enabled: true, apiKey: " search-secret " });
    expect(getSearchConfig()).toEqual({ provider: "tinyfish", enabled: true, apiKey: "search-secret" });
    expect(storage.get(SEARCH_CONFIG_KEY)).toBe('{"enabled":true,"provider":"tinyfish"}');
    expect([...storage.values()].join()).not.toContain("secret");
    expect(getSecret("ai-api-key.openai")).toBe("model-secret");
    saveSearchConfig({ ...getSearchConfig(), enabled: false });
    expect(getSearchConfig().apiKey).toBe("search-secret");
    saveSearchConfig({ ...getSearchConfig(), apiKey: "" });
    expect(getSecret("ai-api-key.search.tinyfish")).toBe("");
  } finally { setSecret("ai-api-key.openai", previous); }
});

test("registry providers retain independent credentials when switching", () => {
  const registry = WEB_PROVIDERS as Record<string, WebProvider>;
  registry.fixture = { ...registry.tinyfish, id: "fixture" };
  try {
    saveSearchConfig({ provider: "tinyfish", enabled: true, apiKey: "first-key" });
    saveSearchConfig({ provider: "fixture" as "tinyfish", enabled: true, apiKey: "second-key" });
    expect(getSearchConfig().apiKey).toBe("second-key");
    expect(getSecret("ai-api-key.search.tinyfish")).toBe("first-key");
    saveSearchConfig({ provider: "tinyfish", enabled: true, apiKey: "first-key" });
    expect(getSecret("ai-api-key.search.fixture")).toBe("second-key");
  } finally { delete registry.fixture; }
});

test("unknown or malformed stored provider cannot silently enable TinyFish", () => {
  setSecret("ai-api-key.search.tinyfish", "existing");
  for (const raw of ['{"provider":"unknown","enabled":true}', '{"provider":"tinyfish","enabled":"true"}', 'null', '{bad']) {
    storage.set(SEARCH_CONFIG_KEY, raw);
    let code: string | undefined;
    expect(getSearchConfig(error => { code = error.code; }).enabled).toBe(false);
    expect(code).toBe("search/not-configured");
  }
});

test("one provider owns both operations; retired fetch settings cannot cause a fallback", async () => {
  const factories = Object.values(WEB_PROVIDERS).map(provider => spyOn(provider, "create").mockImplementation(apiKey => {
    expect(apiKey).toBe(`secret-${provider.id}`);
    return {
      search: async input => ({ provider: provider.id, query: input.query, sources: [], retrievedAt: "now" }),
      ...(provider.supportsFetch ? { fetch: async (input: { url: string }) => ({ provider: provider.id, url: input.url,
        finalUrl: input.url, title: "Source", text: "Page text", offset: 0, nextOffset: null, retrievedAt: "now" }) } : {}),
    };
  }));
  try {
    for (const provider of Object.keys(WEB_PROVIDERS) as (keyof typeof WEB_PROVIDERS)[]) {
      saveSearchConfig({ provider, enabled: true, apiKey: `secret-${provider}` });
    }
    for (const provider of Object.values(WEB_PROVIDERS)) {
      // A saved TinyFish key and old fallback configuration must have no effect.
      storage.set(SEARCH_CONFIG_KEY, JSON.stringify({ provider: provider.id, enabled: true, fetchProvider: "tinyfish" }));
      expect(agentWeb.configured("search")).toBe(true);
      expect(agentWeb.configured("fetch")).toBe(provider.supportsFetch);
      expect((await agentWeb.search({ query: "release" })).provider).toBe(provider.id);
      if (provider.supportsFetch) expect((await agentWeb.fetch({ url: "https://example.org" })).provider).toBe(provider.id);
      else await expect(agentWeb.fetch({ url: "https://example.org" })).rejects.toMatchObject({ code: "search/fetch-failed" });
      saveSearchConfig(getSearchConfig());
      expect(JSON.parse(storage.get(SEARCH_CONFIG_KEY)!)).toEqual({ enabled: true, provider: provider.id });
      saveSearchConfig({ ...getSearchConfig(), apiKey: "" });
      expect(agentWeb.configured("search")).toBe(false); expect(agentWeb.configured("fetch")).toBe(false);
      await expect(agentWeb.fetch({ url: "https://example.org" })).rejects.toMatchObject({ code: "search/not-configured" });
      saveSearchConfig({ ...getSearchConfig(), apiKey: `secret-${provider.id}`, enabled: false });
      expect(agentWeb.configured("search")).toBe(false); expect(agentWeb.configured("fetch")).toBe(false);
    }
    for (const provider of Object.keys(WEB_PROVIDERS)) expect(getSecret(`ai-api-key.search.${provider}`)).toBe(`secret-${provider}`);
    expect([...storage.values()].join()).not.toContain("secret-");
    for (const factory of factories) expect(factory).toHaveBeenCalledTimes(2);
  } finally {
    for (const factory of factories) factory.mockRestore();
    for (const provider of Object.keys(WEB_PROVIDERS)) deleteSecret(`ai-api-key.search.${provider}`);
  }
});
