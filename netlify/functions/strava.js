// Fonction Netlify : échange et rafraîchit les jetons Strava, relaie la liste d'activités.
// Variables d'environnement à définir sur Netlify : STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET.
exports.handler = async (event) => {
  // Les identifiants viennent des variables Netlify si elles existent, sinon de l'app (enregistrés sur ton compte Firebase).
  const envId = process.env.STRAVA_CLIENT_ID, envSecret = process.env.STRAVA_CLIENT_SECRET;
  const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });
  const q = event.queryStringParameters || {};
  if (event.httpMethod === "GET" && q.action === "config") return json(200, { clientId: envId || null, setup: !(envId && envSecret) });
  if (event.httpMethod === "POST") {
    let b = {}; try { b = JSON.parse(event.body || "{}"); } catch (e) {}
    const id = envId || String(b.client_id || ""), secret = envSecret || String(b.client_secret || "");
    if (!id || !secret) return json(400, { error: "missing_credentials" });
    const grant = b.action === "exchange" ? { grant_type: "authorization_code", code: b.code }
                : b.action === "refresh" ? { grant_type: "refresh_token", refresh_token: b.refresh_token } : null;
    if (!grant) return json(400, { error: "bad_request" });
    const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: id, client_secret: secret, ...grant }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json(r.status, { error: d.message || "strava_error", fields: (d.errors || []).map(e => (e.field || e.resource || "") + ":" + (e.code || "")).join(", ") });
    return json(200, { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at,
      athlete: d.athlete ? { id: d.athlete.id, firstname: d.athlete.firstname || "" } : null });
  }
  if (event.httpMethod === "GET" && q.action === "activities") {
    const auth = event.headers.authorization || event.headers.Authorization;
    if (!auth) return json(401, { error: "no_token" });
    const u = new URL("https://www.strava.com/api/v3/athlete/activities");
    u.searchParams.set("per_page", "100"); u.searchParams.set("page", String(parseInt(q.page) || 1));
    if (q.after) u.searchParams.set("after", String(parseInt(q.after) || 0));
    const r = await fetch(u, { headers: { Authorization: auth } });
    return { statusCode: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: await r.text() };
  }
  return json(400, { error: "bad_request" });
};
