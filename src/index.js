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

// Account codes are 128-bit CSPRNG-generated secrets. A short PIN is not safe:
// the code acts as the only credential to access and edit the owner's car history.
const CODE_RE = /^CS-[0-9A-F]{32}$/;
const jsonNoStore = (body, status=200) =>
  Response.json(body, {status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function tokenFrom(req){return (req.headers.get("Authorization")||"").replace(/^Bearer /,"");}
async function resolveAccount(code,env){
  if(!CODE_RE.test(code))return null;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(code))),b=>b.toString(16).padStart(2,"0")).join("");
  const stub=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-user-"+hash));
  const exists=await stub.fetch("https://car-data.internal/data");
  if(!exists.ok)return null;
  return {stub,scope:hash};
}
async function getAccount(req,env){return resolveAccount(tokenFrom(req),env);}
async function getLegacyData(env){
  const stub=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-primary"));
  let current=await stub.fetch("https://car-data.internal/data");
  if(current.status===404){
    let legacy={};
    try{const saved=await env.DATA.get("data");if(saved)legacy=JSON.parse(saved);}
    catch{return {error:jsonNoStore({error:"Δεν διαβάστηκε το παλιό ιστορικό."},503)};}
    const bootstrap=await stub.fetch("https://car-data.internal/bootstrap",{
      method:"POST",body:JSON.stringify(legacy)
    });
    if(!bootstrap.ok)return {error:jsonNoStore({error:"Αδυναμία προετοιμασίας ιστορικού."},503)};
    current=await stub.fetch("https://car-data.internal/data");
  }
  if(!current.ok)return {error:jsonNoStore({error:"Το παλιό ιστορικό δεν είναι διαθέσιμο."},503)};
  return {stub,dataset:await current.json()};
}



export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Every account uses a separate SQLite Durable Object. A code for another
    // account CANNOT select, read or write this account's data.
    if (url.pathname === "/api/account/create" && req.method === "POST") {
      // One IP cannot generate unlimited Durable Objects in one day.
      const clientIP=req.headers.get("CF-Connecting-IP")||"unknown";
      const limiter=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-registration-limit"));
      const allowed=await limiter.fetch("https://car-data.internal/limit",{
        method:"POST",body:JSON.stringify({ip:clientIP})
      });
      if(!allowed.ok)return jsonNoStore({error:"Πάρα πολλές δημιουργίες. Δοκίμασε αργότερα."},429);
      const bytes=crypto.getRandomValues(new Uint8Array(16));
      const code="CS-"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(code))),b=>b.toString(16).padStart(2,"0")).join("");
      const stub=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-user-"+hash));
      const made=await stub.fetch("https://car-data.internal/bootstrap",{
        method:"POST",body:JSON.stringify({items:[],settings:{},reminders:[]})
      });
      if(!made.ok)return jsonNoStore({error:"Δεν δημιουργήθηκε ο λογαριασμός."},503);
      return jsonNoStore({code,scope:hash});
    }

    if (url.pathname === "/api/account/login" && req.method === "POST") {
      let code="";
      try{code=String((await req.json()).code||"").trim().toUpperCase();}catch{}
      const account=await resolveAccount(code,env);
      return account?jsonNoStore({scope:account.scope}):
        jsonNoStore({error:"Δεν βρέθηκε λογαριασμός με αυτόν τον κωδικό."},401);
    }

    if (url.pathname === "/api/account/migrate" && req.method === "POST") {
      const account=await getAccount(req,env);
      if(!account)return jsonNoStore({error:"Πρώτα συνδέσου στον νέο σου λογαριασμό."},401);
      const limiter=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-legacy-attempts"));
      const limited=await limiter.fetch("https://car-data.internal/limit",{
        method:"POST",body:JSON.stringify({ip:req.headers.get("CF-Connecting-IP")||"unknown"})
      });
      if(!limited.ok)return jsonNoStore({error:"Πολλές προσπάθειες μεταφοράς. Δοκίμασε αύριο."},429);
      let oldCode="";
      try{oldCode=String((await req.json()).legacyCode||"").trim();}catch{}
      if(!env.PASSCODE||oldCode!==env.PASSCODE)return jsonNoStore({error:"Λάθος παλιός κωδικός."},403);
      const legacy=await getLegacyData(env);
      if(legacy.error)return legacy.error;
      const claimed=await legacy.stub.fetch("https://car-data.internal/claimed");
      if(claimed.status===200){
        const info=await claimed.json();
        if(info.scope===account.scope)return jsonNoStore({ok:true,already:true});
        return jsonNoStore({error:"Το παλιό ιστορικό έχει ήδη μεταφερθεί."},409);
      }
      const target=await account.stub.fetch("https://car-data.internal/data");
      if(!target.ok)return jsonNoStore({error:"Ο νέος λογαριασμός δεν είναι διαθέσιμος."},503);
      const existing=await target.json();
      if(existing.revision!==1 || existing.items?.length || existing.reminders?.length ||
          Object.keys(existing.settings||{}).length) {
        return jsonNoStore({error:"Φτιάξε νέο, κενό λογαριασμό για τη μεταφορά του παλιού ιστορικού."},409);
      }
      // Atomically reserve the legacy snapshot for ONE destination account.
      // Concurrent claim attempts cannot copy the same history to two users.
      const reserved=await legacy.stub.fetch("https://car-data.internal/reserve",{
        method:"POST",body:JSON.stringify({scope:account.scope})
      });
      if(!reserved.ok)return jsonNoStore({error:"Το παλιό ιστορικό έχει δεσμευτεί από άλλο λογαριασμό."},409);
      const imported=await account.stub.fetch("https://car-data.internal/restore-legacy",{
        method:"POST",body:JSON.stringify(legacy.dataset)
      });
      if(!imported.ok)return jsonNoStore({error:"Ο νέος λογαριασμός πρέπει να είναι κενός για τη μεταφορά."},409);
      const locked=await legacy.stub.fetch("https://car-data.internal/claim",{
        method:"POST",body:JSON.stringify({scope:account.scope})
      });
      if(!locked.ok)return jsonNoStore({error:"Η μεταφορά χρειάζεται έλεγχο. Το παλιό ιστορικό παραμένει ασφαλές."},409);
      return jsonNoStore({ok:true});
    }

    if (url.pathname === "/api/data") {
      const account=await getAccount(req,env);
      if(!account)return jsonNoStore({error:"Δεν υπάρχει έγκυρος λογαριασμός."},401);
      if(req.method!=="GET"&&req.method!=="PUT")return new Response("method not allowed",{status:405});
      if(req.method==="GET")return account.stub.fetch("https://car-data.internal/data");
      return account.stub.fetch("https://car-data.internal/data",{
        method:"PUT",headers:{"Content-Type":"application/json"},body:await req.text()
      });
    }

    if (url.pathname === "/api/diagnose") {
      if (!(await getAccount(req, env))) return new Response("unauthorized", {
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
      if (!(await getAccount(req, env))) return new Response("unauthorized", { status: 401 });
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

    if(url.pathname==="/limit"&&request.method==="POST"){
      let ip;
      try{ip=String((await request.json()).ip||"unknown").slice(0,80);}catch{ip="unknown";}
      const key="limit:"+ip,now=Date.now();
      const allowed=await this.state.storage.transaction(async tx=>{
        const record=(await tx.get(key))||{since:now,count:0};
        if(now-record.since>86400000){record.since=now;record.count=0;}
        if(record.count>=10)return false;
        record.count++;await tx.put(key,record);return true;
      });
      return json({ok:allowed},allowed?200:429);
    }
    if(url.pathname==="/claimed"&&request.method==="GET"){
      const scope=await this.state.storage.get("claimedAccount");
      return json({claimed:Boolean(scope),scope:scope||null},scope?200:404);
    }
    if(url.pathname==="/reserve"&&request.method==="POST"){
      let scope="";try{scope=String((await request.json()).scope||"");}catch{}
      if(!/^[a-f0-9]{64}$/.test(scope))return json({error:"bad scope"},400);
      const allowed=await this.state.storage.transaction(async tx=>{
        if(await tx.get("claimedAccount"))return false;
        const current=await tx.get("reservedAccount");
        if(current && current!==scope)return false;
        await tx.put("reservedAccount",scope);return true;
      });
      return json({ok:allowed},allowed?200:409);
    }
    if(url.pathname==="/claim"&&request.method==="POST"){
      let scope="";try{scope=String((await request.json()).scope||"");}catch{}
      if(!/^[a-f0-9]{64}$/.test(scope))return json({error:"bad scope"},400);
      const saved=await this.state.storage.transaction(async tx=>{
        const reserved=await tx.get("reservedAccount");
        if(reserved!==scope)return false;
        const claimed=await tx.get("claimedAccount");
        if(claimed)return claimed===scope;
        await tx.put("claimedAccount",scope);return true;
      });
      return json({ok:saved},saved?200:409);
    }
    if(url.pathname==="/restore-legacy"&&request.method==="POST"){
      let data;try{data=await request.json();}catch{return json({error:"bad data"},400);}
      if(!data||!Array.isArray(data.items)||!Array.isArray(data.reminders)||
        !data.settings||typeof data.settings!=="object")return json({error:"invalid snapshot"},400);
      const saved=await this.state.storage.transaction(async tx=>{
        const current=await tx.get("dataset");
        if(!current||current.revision!==1||current.items.length||
            current.reminders.length||Object.keys(current.settings).length)return false;
        await tx.put("dataset",{items:data.items,settings:data.settings,
          reminders:data.reminders,revision:2});
        return true;
      });
      return json({ok:saved},saved?200:409);
    }

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
