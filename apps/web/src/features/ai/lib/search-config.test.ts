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

test("all search providers retain their own key; fetch credentials never enter ordinary KV", () => {
  try {
    for (const provider of Object.keys(WEB_PROVIDERS) as (keyof typeof WEB_PROVIDERS)[]) {
      saveSearchConfig({ provider, enabled: true, apiKey: `secret-${provider}` });
    }
    saveSearchConfig({ provider: "brave", enabled: true, apiKey: "secret-brave", fetchProvider: "exa", fetchApiKey: "secret-exa" });
    expect(getSearchConfig()).toEqual({ provider: "brave", enabled: true, apiKey: "secret-brave", fetchProvider: "exa", fetchApiKey: "secret-exa" });
    for (const provider of Object.keys(WEB_PROVIDERS)) expect(getSecret(`ai-api-key.search.${provider}`)).toBe(`secret-${provider}`);
    expect(storage.get(SEARCH_CONFIG_KEY)).toBe('{"enabled":true,"provider":"brave","fetchProvider":"exa"}');
    expect([...storage.values()].join()).not.toContain("secret-");
    expect(() => saveSearchConfig({ provider: "brave", enabled: true, apiKey: "secret-brave", fetchProvider: "serpapi" })).toThrow();
    storage.set(SEARCH_CONFIG_KEY, '{"provider":"brave","enabled":true,"fetchProvider":"serpapi"}');
    expect(getSearchConfig().enabled).toBe(false);
  } finally { for (const provider of Object.keys(WEB_PROVIDERS)) deleteSecret(`ai-api-key.search.${provider}`); }
});

test("switching to a reader-capable provider cannot overwrite another key with a stale fallback key", () => {
  try {
    setSecret("ai-api-key.search.exa", "latest-exa");
    saveSearchConfig({ provider: "tavily", apiKey: "tavily-secret", enabled: true, fetchProvider: "exa", fetchApiKey: "stale-exa" });
    expect(getSecret("ai-api-key.search.exa")).toBe("latest-exa");
  } finally { deleteSecret("ai-api-key.search.exa"); deleteSecret("ai-api-key.search.tavily"); }
});


test("desktop port routes search and original-page requests to separate providers and gates them independently", async () => {
  const search = spyOn(WEB_PROVIDERS.brave, "create").mockImplementation(apiKey => {
    expect(apiKey).toBe("brave-secret");
    return { search: async input => ({ provider: "brave", query: input.query, sources: [], retrievedAt: "now" }) };
  });
  const fetch = spyOn(WEB_PROVIDERS.exa, "create").mockImplementation(apiKey => {
    expect(apiKey).toBe("exa-secret");
    return { search: async () => { throw new Error("wrong search provider"); },
      fetch: async input => ({ provider: "exa", url: input.url, finalUrl: input.url, title: "Original", text: "Original text", offset: 0, nextOffset: null, retrievedAt: "now" }) };
  });
  try {
    saveSearchConfig({ enabled: true, provider: "brave", apiKey: "brave-secret", fetchProvider: "exa", fetchApiKey: "" });
    expect(agentWeb.configured("search")).toBe(true); expect(agentWeb.configured("fetch")).toBe(false);
    await expect(agentWeb.fetch({ url: "https://example.org" })).rejects.toMatchObject({ code: "search/not-configured" });
    saveSearchConfig({ ...getSearchConfig(), fetchApiKey: "exa-secret" });
    expect(agentWeb.configured("fetch")).toBe(true);
    expect((await agentWeb.search({ query: "release" })).provider).toBe("brave");
    expect((await agentWeb.fetch({ url: "https://example.org" })).provider).toBe("exa");
    saveSearchConfig({ ...getSearchConfig(), enabled: false });
    expect(agentWeb.configured("search")).toBe(false); expect(agentWeb.configured("fetch")).toBe(false);
  } finally { search.mockRestore(); fetch.mockRestore(); deleteSecret("ai-api-key.search.brave"); deleteSecret("ai-api-key.search.exa"); }
});
