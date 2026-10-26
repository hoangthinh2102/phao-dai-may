/* TURN servers for WebRTC. Without any of these env vars it returns an empty list and the game falls back
   to its MQTT relay when two players cannot connect directly. Set them in Vercel → Project → Settings → Environment Variables.
   - Any provider with fixed credentials (e.g. ExpressTURN free tier):
       TURN_URLS (comma separated, e.g. "turn:relay1.expressturn.com:3478"), TURN_USERNAME, TURN_CREDENTIAL
   - Cloudflare Realtime TURN (short-lived credentials): CF_TURN_KEY_ID, CF_TURN_API_TOKEN */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const list = [];
  const { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL, CF_TURN_KEY_ID, CF_TURN_API_TOKEN } = process.env;
  if (TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL) {
    const urls = TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length) list.push({ urls, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }
  if (CF_TURN_KEY_ID && CF_TURN_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
      });
      const j = await r.json();
      // browsers block port 53, and trying it only slows the connection down
      for (const s of [].concat(j.iceServers || [])) {
        const urls = [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u));
        if (urls.length) list.push({ ...s, urls });
      }
    } catch (e) { /* Cloudflare unreachable: use whatever else is configured */ }
  }
  res.status(200).json({ iceServers: list });
};
