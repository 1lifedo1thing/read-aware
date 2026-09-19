import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { WEB_PROVIDERS, type WebProvider } from "@read-aware/agent";
import { hydrateSecrets, deleteSecret, getSecret, setSecret } from "../../../platform/secret-store";
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
