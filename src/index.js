import {handleDiagnosticRequest} from "./diagnostics.js";

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
      if (req.method !== "GET" && req.method !== "PUT") {
        return new Response("method not allowed", { status: 405 });
      }

      // The single-user Durable Object guarantees that simultaneous updates
      // cannot silently overwrite each other, unlike a shared KV key.
      const stub = env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-primary"));
      let result = await stub.fetch("https://car-data.internal/data");
      if (result.status === 404) {
        // One-time, non-destructive migration: read existing KV data into DO.
        let legacy = {};
        try {
          const text = await env.DATA.get("data");
          if (text) legacy = JSON.parse(text);
        } catch (error) {
          console.error("Legacy KV import failed", error);
          return new Response("legacy data could not be loaded", { status: 503 });
        }
        const seeded = await stub.fetch("https://car-data.internal/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(legacy)
        });
        if (!seeded.ok) return new Response("data migration failed", { status: 503 });
        result = await stub.fetch("https://car-data.internal/data");
      }
      if (req.method === "GET") return result;
      // PUT carries the client's last-seen revision. The DO validates it
      // transactionally and returns 409 on concurrent changes.
      return stub.fetch("https://car-data.internal/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: await req.text()
      });
    }

    if (url.pathname === "/api/diagnose") {
      if (!authed(req, env)) return new Response("unauthorized", {
        status: 401,
        headers: {"Cache-Control":"no-store"}
      });
      if (req.method !== "POST") return new Response("method not allowed", {
        status: 405,
        headers: {"Cache-Control":"no-store","Allow":"POST"}
      });
      return handleDiagnosticRequest(req, env);
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


// SQLite-backed Durable Object. Existing records remain in KV as a
// read-only migration backup; new writes are strongly consistent here.
export class CarServiceStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const json = (data, status = 200) =>
      Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

    if (url.pathname === "/bootstrap" && request.method === "POST") {
      let legacy;
      try { legacy = await request.json(); }
      catch { return json({ error: "invalid legacy data" }, 400); }
      if (!legacy || typeof legacy !== "object") legacy = {};
      await this.state.storage.transaction(async tx => {
        const current = await tx.get("dataset");
        if (current) return;
        await tx.put("dataset", {
          items: Array.isArray(legacy.items) ? legacy.items : [],
          settings: legacy.settings && typeof legacy.settings === "object" ? legacy.settings : {},
          reminders: Array.isArray(legacy.reminders) ? legacy.reminders : [],
          revision: 1
        });
      });
      return json({ ok: true });
    }

    if (url.pathname !== "/data") return json({ error: "not found" }, 404);
    if (request.method === "GET") {
      const data = await this.state.storage.get("dataset");
      if (!data) return json({ error: "not initialized" }, 404);
      return json(data);
    }
    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);

    const raw = await request.text();
    if (raw.length > 5_000_000) return json({ error: "too big" }, 413);
    let next;
    try { next = JSON.parse(raw); }
    catch { return json({ error: "invalid json" }, 400); }
    if (!next || !Array.isArray(next.items) || !Array.isArray(next.reminders) ||
        !next.settings || typeof next.settings !== "object" ||
        next.items.length > 20000 || next.reminders.length > 2000 ||
        !Number.isInteger(next.revision)) {
      return json({ error: "invalid dataset or revision" }, 400);
    }

    const outcome = await this.state.storage.transaction(async tx => {
      const current = await tx.get("dataset");
      if (!current) return { status: 409, body: { error: "not initialized" } };
      if (next.revision !== current.revision) {
        return { status: 409, body: { error: "revision conflict", revision: current.revision } };
      }
      const saved = {
        items: next.items,
        settings: next.settings,
        reminders: next.reminders,
        revision: current.revision + 1
      };
      await tx.put("dataset", saved);
      return { status: 200, body: saved };
    });
    return json(outcome.body, outcome.status);
  }
}
