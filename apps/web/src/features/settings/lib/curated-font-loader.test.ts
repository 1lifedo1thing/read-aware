import { afterAll, expect, test } from "bun:test";
import { curatedFacesFor } from "./curated-fonts";
import { ensureCuratedFontFaceCss, localCuratedFontFaceCss } from "./curated-font-loader";

// A minimal IndexedDB: the loader only opens one store and gets, lists and puts keys.
const cached = new Map<IDBValidKey, ArrayBuffer>();
function answer<T>(result: () => T) {
  const request = {} as { result?: T; onsuccess?: () => void };
  queueMicrotask(() => {
    request.result = result();
    request.onsuccess?.();
  });
  return request;
}
const database = {
  transaction() {
    const transaction = { oncomplete: undefined as (() => void) | undefined };
    return Object.assign(transaction, {
      objectStore: () => ({
        get: (key: IDBValidKey) => answer(() => cached.get(key)),
        getAllKeys: () => answer(() => [...cached.keys()]),
        put(value: ArrayBuffer, key: IDBValidKey) {
          cached.set(key, value);
          queueMicrotask(() => transaction.oncomplete?.());
        },
      }),
    });
  },
};
const fetched: string[] = [];
const originals = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
Object.assign(globalThis, {
  indexedDB: { open: () => answer(() => database) },
  fetch: (url: string) => {
    fetched.push(url);
    return Promise.resolve(new Response(new ArrayBuffer(4)));
  },
});
afterAll(() => Object.assign(globalThis, originals));

test("a font is local only when every face it needs is cached on this device", async () => {
  const weights = [400];
  const faces = curatedFacesFor("literata").filter((face) => face.weight === 400);
  expect(faces.length).toBeGreaterThan(1);
  for (const face of faces.slice(1)) cached.set(face.url, new ArrayBuffer(4));

  // One face missing means a download — which the local path never starts.
  expect(await localCuratedFontFaceCss("literata", weights)).toBeNull();
  expect(fetched).toEqual([]);

  cached.set(faces[0].url, new ArrayBuffer(4));
  const css = await localCuratedFontFaceCss("literata", weights);
  expect(css?.match(/@font-face/g)).toHaveLength(faces.length);
  expect(fetched).toEqual([]);

  // Once built this session, the CSS no longer depends on the cache.
  cached.clear();
  expect(await localCuratedFontFaceCss("literata", weights)).toBe(css);
  expect(await ensureCuratedFontFaceCss("literata", weights)).toBe(css!);
  expect(fetched).toEqual([]);
});
