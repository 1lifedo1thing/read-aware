/** Loopback-only, disposable WebDAV mailbox for isolated desktop acceptance.
 * Reuses the protocol fixture; never use this in production. Stop loses data.
 * GET /__evidence returns ciphertext object metadata; POST /__fault with
 * {"status":503} enables an outage and {"status":null} restores service.
 */
import { fakeWebdavServer } from "../plugins/webdav-sync/tests/fake-webdav";

const dav = fakeWebdavServer();
const requests: Array<{ method: string; path: string; status: number; bytes: number }> = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.SYNC_ACCEPTANCE_PORT ?? 18891),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/__fault" && request.method === "POST") {
      const { status } = await request.json() as { status: number | null };
      if (status !== null && status !== 503) return new Response("Only 503/null", { status: 400 });
      dav.failWith = status;
      return Response.json({ status });
    }
    if (path === "/__evidence") {
      return Response.json({
        boundary: "Loopback HTTP fixture; desktop acceptance is recorded separately",
        faultStatus: dav.failWith,
        requests,
        objects: [...dav.files].map(([path, bytes]) => ({
          path, byteSize: bytes.length,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
          // Synthetic fixture content only; allows proving no marker plaintext
          // crossed the transport. No production data should reach this server.
          base64: Buffer.from(bytes).toString("base64"),
        })),
      });
    }
    const body = new Uint8Array(await request.arrayBuffer());
    const response = await dav.fetchFn(request.url, {
      method: request.method, headers: request.headers,
      ...(body.length ? { body } : {}),
    });
    requests.push({ method: request.method, path, status: response.status, bytes: body.length });
    return response;
  },
});
console.log(`Disposable sync acceptance WebDAV: ${server.url}`);
