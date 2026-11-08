// Forma — enregistrement des notifications push (rappels même app fermée).
// Les rappels de chaque appareil sont stockés dans Netlify Blobs ; la clé VAPID est créée
// automatiquement au premier appel et gardée côté serveur. Aucune variable à configurer.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function vapidKeys() {
  const cfg = getStore("forma-push-config");
  let k = await cfg.get("vapid", { type: "json" });
  if (!k || !k.publicKey || !k.privateKey) {
    k = webpush.generateVAPIDKeys();
    await cfg.setJSON("vapid", k);
  }
  return k;
}

const clean = (s, n) => String(s ?? "").slice(0, n);

export default async (req) => {
  const subs = getStore("forma-push-subs");
  if (req.method === "GET") {
    const k = await vapidKeys();
    return json({ publicKey: k.publicKey });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b = {};
  try { b = await req.json(); } catch (e) {}
  const id = String(b.id || "");
  if (!/^[a-f0-9]{32}$/.test(id)) return json({ error: "bad_id" }, 400);

  if (b.action === "unregister") { await subs.delete(id); return json({ ok: true }); }

  if (b.action === "register") {
    const sub = b.sub || {};
    if (!/^https:\/\//.test(sub.endpoint || "") || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "bad_subscription" }, 400);
    const now = Date.now();
    const reminders = (Array.isArray(b.reminders) ? b.reminders : []).slice(0, 200)
      .map(r => ({ at: clean(r.at, 40), tag: clean(r.tag, 80), title: clean(r.title, 120), body: clean(r.body, 400) }))
      .filter(r => r.tag && r.title && !isNaN(Date.parse(r.at)) && Date.parse(r.at) > now - 3 * 3600e3 && Date.parse(r.at) < now + 40 * 864e5);
    const prev = (await subs.get(id, { type: "json" })) || {};
    await subs.setJSON(id, { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, reminders, sent: prev.sent || {}, updated: now });
    return json({ ok: true, count: reminders.length });
  }

  if (b.action === "test") {
    const data = await subs.get(id, { type: "json" });
    if (!data?.sub) return json({ error: "not_registered" }, 404);
    const k = await vapidKeys();
    webpush.setVapidDetails(process.env.URL || "mailto:forma@example.com", k.publicKey, k.privateKey);
    try {
      await webpush.sendNotification(data.sub, JSON.stringify({ title: clean(b.title || "Forma", 120), body: clean(b.body || "Notifications activées.", 400), tag: "forma-test" }), { TTL: 3600 });
      return json({ ok: true });
    } catch (e) {
      return json({ error: "send_failed", status: e?.statusCode || 0 }, 502);
    }
  }
  return json({ error: "bad_request" }, 400);
};
