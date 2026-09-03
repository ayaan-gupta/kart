/**
 * Serves the two recognition handlers on this machine so a phone on the same wifi can reach
 * them. It exists because `api/census.ts` and `api/identify.ts` are written as Vercel
 * functions: they export a Web `Request` -> `Response` handler and nothing in the repository
 * ever binds a socket. That is fine in production and useless for putting the app on a phone,
 * which is a stated requirement.
 *
 * This is a development server. It is not the deployment: no TLS, no auth, no rate limiting.
 * It binds to every interface on purpose, which is the entire point (a phone cannot reach
 * 127.0.0.1 on a laptop) and also the reason not to run it on a network you do not trust.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";

/** 3000, 8000 and 5432 are taken on the development machine, so the default avoids them. */
const DEFAULT_PORT = 4310;

/**
 * The key is checked before the handlers are imported, not after, because `src/openai.ts`
 * throws at module scope when it is missing. Importing first meant this process died with a
 * stack trace from inside a dependency, and a friendlier message placed further down could
 * never run. The import below is therefore dynamic and deliberately ordered.
 */
if ((process.env.OPENAI_API_KEY ?? "") === "") {
  console.error("[serve] OPENAI_API_KEY is not set, so nothing could be recognized.");
  console.error("[serve] Put a key in server/.env.local, which git ignores, then start it with:");
  console.error("[serve]");
  console.error("[serve]   npm run serve --prefix server");
  console.error("[serve]");
  console.error("[serve] `npm run serve` reads that file itself. ./scripts/setup.sh writes it for");
  console.error("[serve] you, or: echo 'OPENAI_API_KEY=sk-...' >> server/.env.local");
  process.exit(1);
}

const { default: census } = await import("../api/census.js");
const { default: identify } = await import("../api/identify.js");

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  "/api/census": census,
  "/api/identify": identify,
};

/**
 * Node gives us a stream and a header bag; the handlers want a WHATWG `Request`. The body is
 * buffered rather than streamed because both handlers read it whole anyway (they parse JSON),
 * and because a streamed body would need `duplex: 'half'` and gains nothing here.
 *
 * `content-length` is passed through deliberately: `assertReasonableContentLength` in
 * `src/http.ts` reads it to reject an oversized body before decoding, and dropping the header
 * would quietly disable that check.
 */
async function toRequest(req: IncomingMessage, url: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

/**
 * Cross-origin headers, for a browser build of the app and nothing else.
 *
 * The phone is not subject to CORS: a native fetch has no origin and the browser's rule does not
 * apply to it. A web build does, and `npx expo export --platform web` is the only way to exercise
 * the whole capture path on a machine with no Xcode, so without this the app can be run in a
 * browser but can never name anything.
 *
 * Only loopback origins are reflected, rather than `*`. This server binds every interface and
 * spends money on each request, so `*` would let any page in any tab on this network call it and
 * run up an OpenAI bill. A page served from somewhere else has that somewhere else as its origin
 * and is refused; nothing here can be reached cross-origin from the open internet.
 */
function allowedOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return null;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
      ? origin
      : null;
  } catch {
    return null;
  }
}

async function send(res: ServerResponse, response: Response, origin?: string | null): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

/** Every IPv4 address a phone on the same network could plausibly dial. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];

  // One line per request, with the caller's address. This is the only way to tell, from this
  // side, whether a phone reached the laptop at all: a scan that produces nothing looks
  // identical whether the request never arrived or the model returned nothing, and the phone
  // cannot be asked. Nothing from the body is logged, so no image and no key can land here.
  console.log(`[serve] ${req.socket.remoteAddress ?? "?"} ${req.method ?? "?"} ${path}`);

  const origin = allowedOrigin(req);

  // The preflight a browser sends before a JSON POST from another origin. Answered before
  // routing, because it is asked about a route rather than sent to one.
  if (req.method === "OPTIONS") {
    res.statusCode = origin ? 204 : 403;
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-max-age", "600");
      res.setHeader("vary", "origin");
    }
    res.end();
    return;
  }

  // A plain GET on the root is how you check from the phone's browser that the laptop is
  // reachable at all, which separates "wrong address or firewall" from "recognition failed"
  // before any scanning is attempted.
  if (path === "/" && req.method === "GET") {
    void send(res, new Response(JSON.stringify({ ok: true, routes: Object.keys(ROUTES) }), {
      headers: { "content-type": "application/json" },
    }), origin);
    return;
  }

  const handler = ROUTES[path];
  if (handler === undefined) {
    void send(res, new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }), origin);
    return;
  }

  void (async () => {
    try {
      const request = await toRequest(req, `http://localhost:${port}${req.url ?? "/"}`);
      await send(res, await handler(request), origin);
    } catch (error) {
      // The handlers already redact upstream errors; this catches failures in the adapter
      // itself, and must be equally careful never to put the cause on the wire.
      console.error("[serve]", error);
      if (!res.headersSent) {
        void send(res, new Response(JSON.stringify({ error: "Recognition failed" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }), origin);
      }
    }
  })();
});

server.listen(port, "0.0.0.0", () => {
  const addresses = lanAddresses();
  console.log(`[serve] listening on port ${port}`);
  if (addresses.length === 0) {
    console.log("[serve] no external network interface found, so no phone can reach this.");
    return;
  }
  console.log("[serve] set this in the app's .env, then rebuild it:");
  for (const address of addresses) {
    console.log(`[serve]   EXPO_PUBLIC_KART_API_URL=http://${address}:${port}`);
  }
});
