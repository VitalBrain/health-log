// Forma — envoi des rappels programmés, toutes les 15 minutes, même quand l'app est fermée.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { vapidKeys } from "./push.mjs";

export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const subs = getStore("forma-push-subs");
  const k = await vapidKeys();
  webpush.setVapidDetails(process.env.URL || "mailto:forma@example.com", k.publicKey, k.privateKey);
  const now = Date.now();
  const { blobs } = await subs.list();
  let sentCount = 0;
  for (const { key } of blobs) {
    const data = await subs.get(key, { type: "json" });
    if (!data?.sub) continue;
    const sent = data.sent || {};
    let changed = false, gone = false;
    for (const r of data.reminders || []) {
      const at = Date.parse(r.at);
      if (sent[r.tag] || isNaN(at) || at > now || at < now - 3 * 3600e3) continue;
      try {
        await webpush.sendNotification(data.sub, JSON.stringify({ title: r.title, body: r.body, tag: r.tag }), { TTL: 6 * 3600 });
        sent[r.tag] = now; changed = true; sentCount++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) { gone = true; break; }
      }
    }
    if (gone) { await subs.delete(key); continue; }
    for (const t in sent) if (sent[t] < now - 5 * 864e5) { delete sent[t]; changed = true; }
    const keep = (data.reminders || []).filter(r => Date.parse(r.at) > now - 864e5);
    if (keep.length !== (data.reminders || []).length) changed = true;
    if (changed) await subs.setJSON(key, { ...data, reminders: keep, sent });
  }
  console.log(`forma push-cron: ${blobs.length} appareil(s), ${sentCount} notification(s) envoyée(s)`);
};
