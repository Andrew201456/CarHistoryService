const SYSTEM = `Είσαι βοηθός που διαβάζει κείμενο από ιστορικό service αυτοκινήτου (συχνά ακατάστατο, από αντιγραφή ιστοσελίδας) και το μετατρέπει σε δομημένες καταχωρήσεις.
Κανόνες:
- Κάθε επίσκεψη/service σε διαφορετική ημερομηνία είναι ξεχωριστή καταχώρηση.
- date: σε μορφή YYYY-MM-DD. Μετάτρεψε π.χ. 15/03/2021 ή 15.03.21 σε 2021-03-15. Αν δεν υπάρχει ημερομηνία, άφησε "".
- km: μόνο ψηφία χωρίς τελείες ή κόμματα (π.χ. 145000). Αν δεν υπάρχουν, "".
- parts: λίστα με εργασίες/ανταλλακτικά. name = περιγραφή στα ελληνικά όπως γράφεται. cost = τιμή ως αριθμός με τελεία για δεκαδικά (π.χ. "45.5") ή "" αν δεν υπάρχει.
- labor: συνολικό κόστος εργασίας/μεροκάματου ως αριθμός, αλλιώς "".
- where: όνομα συνεργείου/αντιπροσωπείας, αλλιώς "".
- notes: οτιδήποτε άλλο χρήσιμο που δεν χωράει αλλού, αλλιώς "".
- ΜΗΝ επινοείς δεδομένα. Αν κάτι δεν υπάρχει στο κείμενο, άφησέ το κενό.
- Αγνόησε διαφημίσεις, μενού ιστοσελίδας και άσχετα κείμενα.
Απάντησε ΜΟΝΟ με JSON.`;

const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          km: { type: "string" },
          parts: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, cost: { type: "string" } },
              required: ["name", "cost"],
            },
          },
          labor: { type: "string" },
          where: { type: "string" },
          notes: { type: "string" },
        },
        required: ["date", "km", "parts", "labor", "where", "notes"],
      },
    },
  },
  required: ["entries"],
};

function authed(req, env) {
  const auth = req.headers.get("Authorization") || "";
  return env.PASSCODE && auth === "Bearer " + env.PASSCODE;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/data") {
      if (!authed(req, env)) return new Response("unauthorized", { status: 401 });
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

    if (url.pathname === "/api/parse" && req.method === "POST") {
      if (!authed(req, env)) return new Response("unauthorized", { status: 401 });
      let text = "";
      try { text = String((await req.json()).text || ""); } catch {}
      if (!text.trim()) return new Response("empty", { status: 400 });
      text = text.slice(0, 12000);
      try {
        const r = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: text },
          ],
          response_format: { type: "json_schema", json_schema: SCHEMA },
          max_tokens: 4096,
          temperature: 0,
        });
        let out = r.response;
        if (typeof out === "string") {
          const m = out.match(/\{[\s\S]*\}/);
          out = m ? JSON.parse(m[0]) : { entries: [] };
        }
        const entries = Array.isArray(out && out.entries) ? out.entries : [];
        return new Response(JSON.stringify({ entries }), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response("ai error: " + (e && e.message ? e.message : "unknown"), { status: 502 });
      }
    }

    return env.ASSETS.fetch(req);
  },
};
