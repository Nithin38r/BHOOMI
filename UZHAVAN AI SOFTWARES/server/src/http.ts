/** HTTP API for the gateway and the dashboard, plus a live event stream (Server-Sent Events). */
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Lang, LiveEvent, Settings, Spray } from "../../shared/api.ts";
import type { Hub } from "./hub.ts";

const LANGS: Lang[] = ["en", "te", "ta"];
const KINDS: Spray["kind"][] = ["insect", "fungus", "weed", "other"];

export async function buildHttp(hub: Hub, opts: { token: string | null; webDist: string | null }) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const now = () => Date.now();
  const bad = (reply: FastifyReply, msg: string, code = 400) => reply.code(code).send({ error: msg });

  /** Gateway endpoints need the shared token when one is configured (same header as the BHOOMI twin backend). */
  const gatewayAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (opts.token && req.headers["x-bhoomi-token"] !== opts.token) return bad(reply, "missing or wrong X-BHOOMI-Token", 401);
  };

  /* ------------------------------------------------------------ gateway */
  app.post("/api/ingest", { preHandler: gatewayAuth }, async (req) => {
    const q = req.query as { gw?: string };
    const gw = (req.headers["x-gateway"] as string | undefined) ?? q.gw ?? null;
    return hub.ingestPayload(req.body, gw, now());
  });
  app.get("/api/gateway/commands", { preHandler: gatewayAuth }, async (req, reply) => {
    const gw = (req.query as { gw?: string }).gw ?? null;
    reply.type("text/plain");
    return hub.pendingFor(gw, now()).join("\n");
  });
  app.get("/api/gateway/outbox", { preHandler: gatewayAuth }, async (req) => {
    const since = Number((req.query as { since?: string }).since ?? 0) || 0;
    return hub.store.messages(since, 50).reverse();
  });

  /* ------------------------------------------------------------ dashboard */
  app.get("/api/state", async () => hub.state(now()));

  app.get("/api/devices/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    const hours = Math.min(24 * 7, Math.max(1, Number((req.query as { hours?: string }).hours ?? 24) || 24));
    if (!hub.store.getDevice(id, now())) return bad(reply, "unknown device", 404);
    return hub.store.history(id, now() - hours * 3_600_000);
  });

  app.patch("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: unknown; zone?: unknown };
    const patch: { name?: string; zone?: string | null } = {};
    if (b.name !== undefined) { if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 40) return bad(reply, "name must be 1-40 characters"); patch.name = b.name.trim(); }
    if (b.zone !== undefined) { if (b.zone !== null && (typeof b.zone !== "string" || b.zone.length > 40)) return bad(reply, "zone must be text up to 40 characters"); patch.zone = b.zone ? String(b.zone).trim() : null; }
    const d = hub.renameDevice(id, patch, now());
    return d ?? bad(reply, "unknown device", 404);
  });

  app.post("/api/commands", async (req, reply) => {
    const b = (req.body ?? {}) as { deviceId?: string; cmd?: string; val?: string };
    if (!b.deviceId || !b.cmd || !b.val) return bad(reply, "deviceId, cmd and val are required");
    try { return hub.command(String(b.deviceId), String(b.cmd).toUpperCase(), String(b.val).toUpperCase(), "farmer", "tapped in the app", now()); }
    catch (e) { return bad(reply, e instanceof Error ? e.message : String(e)); }
  });

  app.post("/api/sprays", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const product = typeof b.product === "string" ? b.product.trim() : "";
    const kind = b.kind as Spray["kind"];
    const phiDays = Number(b.phiDays), halfLifeDays = Number(b.halfLifeDays);
    const sprayedAt = b.sprayedAt == null ? now() : Number(b.sprayedAt);
    if (!product || product.length > 60) return bad(reply, "product name is required (up to 60 characters)");
    if (!KINDS.includes(kind)) return bad(reply, `kind must be one of ${KINDS.join(", ")}`);
    if (!(phiDays >= 0 && phiDays <= 120)) return bad(reply, "label waiting period must be 0-120 days");
    if (!(halfLifeDays > 0 && halfLifeDays <= 120)) return bad(reply, "half-life must be 0-120 days");
    if (!(sprayedAt <= now() + 60_000 && sprayedAt > now() - 60 * 86_400_000)) return bad(reply, "spray time must be within the last 60 days");
    hub.addSpray({ product, kind, phiDays, halfLifeDays, zone: typeof b.zone === "string" ? b.zone : null, sprayedAt }, now());
    return { ok: true };
  });
  app.delete("/api/sprays/:id", async (req) => {
    hub.deleteSpray(Number((req.params as { id: string }).id), now());
    return { ok: true };
  });

  app.put("/api/settings", async (req, reply) => {
    const b = (req.body ?? {}) as Partial<Settings>;
    const p: Partial<Settings> = {};
    if (b.farmName !== undefined) { if (typeof b.farmName !== "string" || b.farmName.length > 60) return bad(reply, "farmName up to 60 characters"); p.farmName = b.farmName; }
    if (b.language !== undefined) { if (!LANGS.includes(b.language)) return bad(reply, "language must be en, te or ta"); p.language = b.language; }
    if (b.autoIrrigate !== undefined) p.autoIrrigate = !!b.autoIrrigate;
    for (const [k, lo, hi] of [["dryBelow", 5, 80], ["fullAt", 30, 100], ["rainSkipProb", 0, 100], ["doLow", 1, 10], ["lat", -90, 90], ["lon", -180, 180]] as const) {
      if (b[k] !== undefined) { const v = Number(b[k]); if (!(v >= lo && v <= hi)) return bad(reply, `${k} must be ${lo}-${hi}`); p[k] = v; }
    }
    if (b.weatherOverride !== undefined) {
      const o = b.weatherOverride;
      if (o === null) p.weatherOverride = null;
      else {
        const v = { rainProb12h: Number(o.rainProb12h), rainMm24h: Number(o.rainMm24h), rainNowMm: Number(o.rainNowMm ?? 0) };
        if (!(v.rainProb12h >= 0 && v.rainProb12h <= 100 && v.rainMm24h >= 0 && v.rainNowMm >= 0)) return bad(reply, "bad weatherOverride");
        p.weatherOverride = v;
      }
    }
    return hub.saveSettings(p, now());
  });

  app.get("/api/log", async () => hub.store.rawLog(60));

  app.post("/api/admin/reset", { preHandler: gatewayAuth }, async () => {
    hub.store.reset();
    hub.evaluate(now());
    return { ok: true };
  });

  /* ------------------------------------------------------------ live stream */
  app.get("/api/stream", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    const send = (e: LiveEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    hub.on(send);
    const hb = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => { hub.off(send); clearInterval(hb); });
  });

  /* ------------------------------------------------------------ built dashboard (production) */
  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist, wildcard: false });
    // Landing page at /, farmer app at /app/ (built by Vite as two pages).
    app.get("/app", (_req, reply) => reply.redirect("/app/"));
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && req.url.startsWith("/app/")) return reply.sendFile("app/index.html");
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }
  return app;
}
