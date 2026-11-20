export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/data") {
      const auth = req.headers.get("Authorization") || "";
      if (!env.PASSCODE || auth !== "Bearer " + env.PASSCODE)
        return new Response("unauthorized", { status: 401 });

      if (req.method === "GET") {
        const v = await env.DATA.get("data");
        return new Response(v || "{}", { headers: { "content-type": "application/json" } });
      }
      if (req.method === "PUT") {
        const body = await req.text();
        if (body.length > 5_000_000) return new Response("too big", { status: 413 });
        try { JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
        await env.DATA.put("data", body);
        return new Response("ok");
      }
      return new Response("method not allowed", { status: 405 });
    }
    return env.ASSETS.fetch(req);
  },
};
