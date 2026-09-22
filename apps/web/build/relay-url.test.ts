import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { build, normalizePath } from "vite";

const web = resolve(import.meta.dir, "..");
const productionRelay = "https://relay.readaware.app";
const localRelay = "http://localhost:8787";
const productionSite = "https://readaware.app";
const localSite = "http://localhost:5175";

// Exercise Vite's actual env replacement and the resulting JS, including the
// case where Bun has already loaded .env.development before `vite build`.
async function bundle(options: { development?: boolean; relay?: string; site?: string; devHost?: string } = {}) {
  const env = {
    NODE_ENV: options.development ? "development" : "production",
    VITE_READAWARE_RELAY_URL: options.relay ?? "",
    VITE_READAWARE_SITE_URL: options.site ?? "",
    VITE_TAURI_DEV_HOST: options.devHost ?? "",
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const result = await build({
      configFile: false, root: web, logLevel: "silent",
      mode: options.development ? "development" : "production",
      plugins: [{
        name: "relay-url-test-entry",
        resolveId(id) { if (id === "virtual:relay-url-test") return id; },
        load(id) {
          if (id !== "virtual:relay-url-test") return;
          return [
            ["defaultRelayUrl, resolveRelayUrl", "src/platform/sync/relay-url.ts"],
            ["siteBaseUrl", "src/platform/site-url.ts"],
            ["hydrateAppIdentity", "src/platform/app-identity.ts"],
            ["parseSyncLoginUrl", "src/platform/sync/sync-login-link.ts"],
            ["isBillingSuccessUrl", "src/platform/sync/billing-return-link.ts"],
          ].map(([name, path]) => `export { ${name} } from ${JSON.stringify(normalizePath(resolve(web, path!)))};`).join("\n");
        },
      }],
      build: {
        write: false, minify: true,
        lib: { entry: "virtual:relay-url-test", name: "endpoints", formats: ["iife"] },
        rollupOptions: { input: "virtual:relay-url-test", output: { inlineDynamicImports: true } },
      },
    });
    if ("on" in result) throw new Error("Unexpected watch build");
    const output = (Array.isArray(result) ? result[0] : result)!.output;
    const entry = output.find(item => item.type === "chunk" && item.isEntry);
    if (!entry || entry.type !== "chunk") throw new Error("Missing endpoint bundle");
    return entry.code;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runtime(code: string, url: string, productName = "ReadAware", failIdentity = false) {
  const context = {
    URL,
    window: {
      location: new URL(url),
      __TAURI_INTERNALS__: { invoke: async (command: string) => {
        if (failIdentity) throw new Error("Identity unavailable");
        if (command !== "plugin:app|name") throw new Error(`Unexpected IPC: ${command}`);
        return productName;
      } },
    },
  };
  const api = runInNewContext(`${code}\nendpoints;`, context) as {
    hydrateAppIdentity(): Promise<void>;
    defaultRelayUrl(): string;
    siteBaseUrl(): string;
    resolveRelayUrl(raw: string | null): string;
    parseSyncLoginUrl(url: string): string | null;
    isBillingSuccessUrl(url: string): boolean;
  };
  await api.hydrateAppIdentity();
  return api;
}

async function endpoints(code: string, url: string, productName = "ReadAware") {
  const api = await runtime(code, url, productName);
  return { relay: api.defaultRelayUrl(), site: api.siteBaseUrl() };
}

test("release URLs stay on production when Bun preloads local dev URLs on every desktop origin", async () => {
  const code = await bundle({ relay: localRelay, site: localSite });
  for (const origin of ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]) {
    const actual = await endpoints(code, origin);
    expect(actual).toEqual({ relay: productionRelay, site: productionSite });
  }
});

test("release URLs ignore a leaked LAN override too", async () => {
  const code = await bundle({ relay: "http://192.168.1.9:8787", site: "http://192.168.1.9:5175" });
  expect(await endpoints(code, "http://tauri.localhost")).toEqual({ relay: productionRelay, site: productionSite });
});

test("bundled ReadAware Dev still uses explicit device-reachable dev URLs", async () => {
  const relay = "http://192.168.1.9:8787", site = "http://192.168.1.9:5175";
  const code = await bundle({ relay, site });
  expect(await endpoints(code, "tauri://localhost", "ReadAware Dev")).toEqual({ relay, site });
});

test("without env overrides only a dev-identified bundle falls back to the local relay", async () => {
  const code = await bundle();
  expect(await endpoints(code, "http://tauri.localhost")).toEqual({ relay: productionRelay, site: productionSite });
  expect(await endpoints(code, "tauri://localhost", "ReadAware Dev")).toEqual({ relay: localRelay, site: productionSite });
});

test("dev server keeps local defaults and follows a LAN host without using Tauri's synthetic host", async () => {
  const code = await bundle({ development: true, relay: localRelay, site: localSite });
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://tauri.localhost"]) {
    expect(await endpoints(code, origin)).toEqual({ relay: localRelay, site: localSite });
  }
  expect(await endpoints(code, "http://192.168.1.9:5173")).toEqual({ relay: "http://192.168.1.9:8787", site: localSite });
});

test("dev server prefers the Tauri CLI host for devices", async () => {
  const code = await bundle({ development: true, relay: localRelay, devHost: "192.168.1.10" });
  expect((await endpoints(code, "http://tauri.localhost")).relay).toBe("http://192.168.1.10:8787");
});

test("dev cannot reach production through env, legacy KV or host replacement", async () => {
  for (const development of [true, false]) {
    const code = await bundle({ development, relay: productionRelay });
    const api = await runtime(code, "http://tauri.localhost", "ReadAware Dev");
    expect(api.defaultRelayUrl()).toBe(localRelay);
    for (const raw of [null, productionRelay, JSON.stringify(productionRelay), '"https://RELAY.readaware.app.:443/"']) {
      expect(api.resolveRelayUrl(raw)).toBe(localRelay);
    }
    expect(api.resolveRelayUrl('"http://192.168.1.9:8787"')).toBe("http://192.168.1.9:8787");
  }
  const code = await bundle({ development: true, devHost: "relay.readaware.app" });
  expect((await endpoints(code, "http://tauri.localhost", "ReadAware Dev")).relay).toBe(localRelay);
});

test("missing dev env still selects local, and unreadable native identity stops boot", async () => {
  const code = await bundle({ development: true });
  expect((await endpoints(code, "http://localhost:5173")).relay).toBe(localRelay);
  await expect(runtime(code, "http://localhost:5173", "ReadAware Dev", true)).rejects.toThrow("Identity unavailable");
});

test("dev and release accept only their own login and billing callbacks", async () => {
  const code = await bundle();
  for (const [name, own, other] of [["ReadAware", "readaware", "readaware-dev"], ["ReadAware Dev", "readaware-dev", "readaware"]]) {
    const api = await runtime(code, "tauri://localhost", name);
    expect(api.parseSyncLoginUrl(`${own}://sync/login/test-token`)).toBe("test-token");
    expect(api.parseSyncLoginUrl(`${other}://sync/login/test-token`)).toBeNull();
    expect(api.isBillingSuccessUrl(`${own}://billing/success`)).toBe(true);
    expect(api.isBillingSuccessUrl(`${other}://billing/success`)).toBe(false);
  }
});

test("the standard desktop dev entry selects a separate identity and protocol", () => {
  const json = (path: string) => JSON.parse(readFileSync(resolve(web, path), "utf8"));
  expect(json("../../package.json").scripts.dev).toBe("turbo run dev --filter=@read-aware/desktop");
  expect(json("../desktop/package.json").scripts.dev).toBe("tauri dev --config src-tauri/tauri.dev.conf.json");
  const dev = json("../desktop/src-tauri/tauri.dev.conf.json");
  const prod = json("../desktop/src-tauri/tauri.conf.json");
  expect(dev.identifier).toBe("com.readaware.app.dev");
  expect(dev.identifier).not.toBe(prod.identifier);
  expect(dev.productName).toBe("ReadAware Dev");
  expect(dev.plugins["deep-link"].desktop.schemes).toEqual(["readaware-dev"]);
  expect(prod.plugins["deep-link"].desktop.schemes).toEqual(["readaware"]);
  expect(dev.plugins.updater.endpoints).toEqual([]);
  const relayDev = json("../relay/package.json").scripts.dev;
  expect(relayDev).toContain("--local");
  expect(relayDev).toContain("--var APP_LINK_SCHEME:readaware-dev");
  expect(relayDev).toContain("--var RELAY_ORIGIN:http://localhost:8787");
});
