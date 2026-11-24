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

// A user may choose any visible code (digits, Greek, Latin, symbols), without
// fixed length or CS- prefix. Short codes are weak; all NEW accounts must use
// rate-limited login and expiring sessions, never the raw code on data routes.
const SESSION_RE = /^ST-([0-9a-f]{64})-([A-F0-9]{48})$/;
const normalizeAccountCode = value => String(value??"").trim().normalize("NFKC").toUpperCase();
const isValidNewCode = code =>
  typeof code==="string" && code.length>0 && [...code].length<=64 &&
  code.length<=128 && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(code);
const sha256 = async value =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
const generatedCode = () => {
  // Uniform random integer from 0000 to 9999, including leading zeroes.
  const limit=Math.floor(0x100000000/10000)*10000;
  let n;
  do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);
  return String(n%10000).padStart(4,"0");
};
const jsonNoStore = (body, status=200) =>
  Response.json(body, {status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
/* Private cloud documents in the EXISTING per-account SQLite Durable Object.
   Each chunk is 384 KiB (well below the 2 MiB value limit). No new R2 bucket
   or public bucket URLs are required, and /api/documents always checks auth. */
const DOCUMENT_CHUNK=384*1024;
const DOCUMENT_FILE_LIMIT=25*1024*1024;
const DOCUMENT_ACCOUNT_LIMIT=100*1024*1024;
const DOCUMENT_COUNT_LIMIT=50;
const DOCUMENT_KINDS=new Set(["insurance","kteo","tax","emissions","license","registration","roadside","receipt","other"]);
const DOCUMENT_TYPES=new Set(["application/pdf","image/jpeg","image/png","image/webp","image/heic","image/heif"]);
const DOCUMENT_EXTENSIONS={
  pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",
  webp:"image/webp",heic:"image/heic",heif:"image/heif"
};
const DOCUMENT_ID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const docKey=id=>"car-doc:meta:"+id;
const docPart=(id,n)=>"car-doc:part:"+id+":"+n;
const jsonDocument=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
async function documentMetadata(storage){
  return [...(await storage.list({prefix:"car-doc:meta:"})).values()];
}
function cleanDocumentMeta(meta){
  const {id,kind,title,expiry,cost,fileName,mime,size,createdAt,clientKey}=meta;
  return {id,kind,title,expiry,cost,fileName,mime,size,createdAt,clientKey};
}
async function deleteDocumentParts(storage,meta){
  for(let n=0;n<meta.parts;n++)await storage.delete(docPart(meta.id,n));
  await storage.delete(docKey(meta.id));
}
function validDocumentDate(value){
  if(!value)return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}
async function handlePrivateDocuments(req,state){
  const url=new URL(req.url),storage=state.storage,segments=url.pathname.split("/").filter(Boolean);
  if(segments[0]!=="docs")return jsonDocument({error:"not found"},404);
  if(segments.length===1&&req.method==="GET"){
    const docs=(await documentMetadata(storage)).filter(v=>v.status==="ready")
      .map(cleanDocumentMeta).sort((a,b)=>b.createdAt-a.createdAt);
    return jsonDocument({documents:docs,chunkSize:DOCUMENT_CHUNK});
  }
  if(segments.length===1&&req.method==="POST"){
    let input;
    try{input=await req.json();}catch{return jsonDocument({error:"Μη έγκυρα στοιχεία εγγράφου."},400);}
    const kind=String(input?.kind||""),mime=String(input?.mime||""),
      title=String(input?.title||"").trim().slice(0,100),
      fileName=String(input?.fileName||"").split(/[\\/]/).pop().slice(0,160),
      expiry=String(input?.expiry||""),clientKey=String(input?.clientKey||""),
      size=Number(input?.size),cost=input?.cost==null||input.cost===""?"":Number(input.cost);
    if(!DOCUMENT_KINDS.has(kind)||!DOCUMENT_TYPES.has(mime)||!fileName||
       !Number.isSafeInteger(size)||size<1||size>DOCUMENT_FILE_LIMIT||
       DOCUMENT_EXTENSIONS[fileName.split(".").pop().toLowerCase()]!==mime||
       !validDocumentDate(expiry)||(cost!==""&&!Number.isFinite(cost))||
       cost!==""&&(cost<0||cost>999999)||
       !/^[a-zA-Z0-9-]{8,80}$/.test(clientKey))
      return jsonDocument({error:"Μη έγκυρο έγγραφο, μορφή ή μέγεθος (έως 25 MB)."},400);
    const records=await documentMetadata(storage);
    const previous=records.find(v=>v.clientKey===clientKey);
    if(previous)return jsonDocument({id:previous.id,status:previous.status,chunkSize:DOCUMENT_CHUNK});
    // Remove uploads interrupted over 24 hours ago before enforcing quotas.
    const active=[];
    for(const record of records){
      if(record.status!=="ready"&&Date.now()-record.createdAt>86400000){
        await deleteDocumentParts(storage,record);
      }else active.push(record);
    }
    if(active.length>=DOCUMENT_COUNT_LIMIT||
       active.reduce((sum,v)=>sum+v.size,0)+size>DOCUMENT_ACCOUNT_LIMIT)
      return jsonDocument({error:"Ο λογαριασμός έφτασε το όριο των 50 εγγράφων / 100 MB."},413);
    const id=crypto.randomUUID();
    const meta={id,clientKey,kind,title,expiry,cost,fileName,mime,size,
      parts:Math.ceil(size/DOCUMENT_CHUNK),status:"pending",createdAt:Date.now()};
    await storage.put(docKey(id),meta);
    return jsonDocument({id,status:"pending",chunkSize:DOCUMENT_CHUNK},201);
  }
  const id=segments[1];
  if(!DOCUMENT_ID_RE.test(id||""))return jsonDocument({error:"Μη έγκυρο αναγνωριστικό."},400);
  const meta=await storage.get(docKey(id));
  if(!meta)return jsonDocument({error:"Δεν βρέθηκε το έγγραφο."},404);
  if(segments.length===2&&req.method==="DELETE"){
    await deleteDocumentParts(storage,meta);
    return jsonDocument({ok:true});
  }
  if(segments.length===4&&segments[2]==="chunk"&&req.method==="PUT"){
    if(meta.status!=="pending")return jsonDocument({error:"Το έγγραφο έχει ήδη ολοκληρωθεί."},409);
    const rawIndex=segments[3];
    if(!/^(0|[1-9][0-9]{0,2})$/.test(rawIndex))return jsonDocument({error:"Μη έγκυρο τμήμα."},400);
    const index=Number(rawIndex);
    if(index>=meta.parts)return jsonDocument({error:"Τμήμα εκτός ορίων."},400);
    const bytes=await req.arrayBuffer();
    const expected=Math.min(DOCUMENT_CHUNK,meta.size-index*DOCUMENT_CHUNK);
    if(bytes.byteLength!==expected)return jsonDocument({error:"Μη έγκυρο μέγεθος τμήματος."},413);
    await storage.put(docPart(id,index),new Uint8Array(bytes));
    return jsonDocument({ok:true,index});
  }
  if(segments.length===3&&segments[2]==="complete"&&req.method==="POST"){
    if(meta.status==="ready")return jsonDocument({ok:true,document:cleanDocumentMeta(meta)});
    for(let index=0;index<meta.parts;index++){
      const bytes=await storage.get(docPart(id,index));
      if(!(bytes instanceof Uint8Array)||
         bytes.byteLength!==Math.min(DOCUMENT_CHUNK,meta.size-index*DOCUMENT_CHUNK))
        return jsonDocument({error:"Η αποστολή είναι ελλιπής. Προσπάθησε ξανά."},409);
    }
    meta.status="ready";
    await storage.put(docKey(id),meta);
    return jsonDocument({ok:true,document:cleanDocumentMeta(meta)});
  }
  if(segments.length===2&&req.method==="GET"){
    if(meta.status!=="ready")return jsonDocument({error:"Η αποστολή δεν έχει ολοκληρωθεί."},409);
    let index=0;
    const stream=new ReadableStream({
      async pull(controller){
        if(index>=meta.parts){controller.close();return;}
        try{
          const value=await storage.get(docPart(id,index++));
          if(!(value instanceof Uint8Array))throw new Error("Missing document part");
          controller.enqueue(value);
        }catch(error){controller.error(error);}
      }
    });
    return new Response(stream,{headers:{
      "Content-Type":meta.mime,
      "Content-Length":String(meta.size),
      "Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(meta.fileName),
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"
    }});
  }
  return jsonDocument({error:"Μη υποστηριζόμενη ενέργεια."},405);
}

function tokenFrom(req){return (req.headers.get("Authorization")||"").replace(/^Bearer /,"");}
async function resolveAccount(code,env){
  if(!isValidNewCode(code))return null;
  const hash=await sha256(code);
  const stub=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-user-"+hash));
  const exists=await stub.fetch("https://car-data.internal/data");
  if(!exists.ok)return null;
  return {stub,scope:hash};
}
async function newSession(stub,scope){
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(24)),
    b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
  const result=await stub.fetch("https://car-data.internal/session-issue",{
    method:"POST",body:JSON.stringify({secret})
  });
  if(!result.ok)throw new Error("Session could not be created");
  return "ST-"+scope+"-"+secret;
}
async function getAccount(req,env){
  const bearer=tokenFrom(req);
  const session=SESSION_RE.exec(bearer);
  if(session){
    const scope=session[1],secret=session[2];
    const stub=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-user-"+scope));
    const result=await stub.fetch("https://car-data.internal/session-verify",{
      method:"POST",body:JSON.stringify({secret})
    });
    return result.ok?{stub,scope}:null;
  }
  // Keep compatibility ONLY for historical long-form codes. Older four-digit
  // accounts (from v11) lack sessionRequired too, so explicitly exclude them.
  // New accounts of any length still require session via their DO marker.
  const OLD_RAW_RE=/^(?:CS-[A-F0-9]{32}|[A-Z0-9][A-Z0-9_-]{11,63})$/;
  if(!OLD_RAW_RE.test(bearer))return null;
  const account=await resolveAccount(normalizeAccountCode(bearer),env);
  if(!account)return null;
  const legacy=await account.stub.fetch("https://car-data.internal/legacy-auth");
  return legacy.ok?account:null;
}
async function limitAccountLogin(req,env,code){
  const limiter=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-pin-login-limit"));
  return limiter.fetch("https://car-data.internal/login-check",{
    method:"POST",body:JSON.stringify({
      ip:req.headers.get("CF-Connecting-IP")||"unknown",codeHash:await sha256(code)
    })
  });
}
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
      let requestedCode="",manual=false;
      try{
        const payload=await req.json();
        manual=Object.prototype.hasOwnProperty.call(payload||{},"code");
        if(manual&&typeof payload.code!=="string")
          return jsonNoStore({error:"Ο κωδικός πρέπει να είναι κείμενο."},400);
        if(manual)requestedCode=normalizeAccountCode(payload.code);
      }catch{return jsonNoStore({error:"Μη έγκυρα στοιχεία λογαριασμού."},400);}
      if(manual&&!isValidNewCode(requestedCode)){
        return jsonNoStore({error:"Βάλε έναν κωδικό 1–64 χαρακτήρων, χωρίς κρυφούς χαρακτήρες."},400);
      }
      // One IP cannot generate unlimited Durable Objects in one day.
      const clientIP=req.headers.get("CF-Connecting-IP")||"unknown";
      const limiter=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-registration-limit"));
      const allowed=await limiter.fetch("https://car-data.internal/limit",{
        method:"POST",body:JSON.stringify({ip:clientIP})
      });
      if(!allowed.ok)return jsonNoStore({error:"Πάρα πολλές δημιουργίες. Δοκίμασε αργότερα."},429);
      for(let attempt=0;attempt<40;attempt++){
        const code=requestedCode||generatedCode();
        const hash=await sha256(code);
        const stub=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-user-"+hash));
        // Must be atomic: the existing /bootstrap returns 200 even if the
        // dataset already exists. Never grant access to someone else's account!
        const made=await stub.fetch("https://car-data.internal/create-account",{
          method:"POST",body:JSON.stringify({items:[],settings:{},reminders:[]})
        });
        if(made.status===409){
          if(manual)return jsonNoStore({error:"Ο κωδικός χρησιμοποιείται ήδη. Διάλεξε άλλον."},409);
          continue;
        }
        if(!made.ok)return jsonNoStore({error:"Δεν δημιουργήθηκε ο λογαριασμός."},503);
        return jsonNoStore({code,scope:hash,session:await newSession(stub,hash)});
      }
      return jsonNoStore({error:"Δεν δημιουργήθηκε μοναδικός κωδικός. Δοκίμασε ξανά."},503);
    }

    if (url.pathname === "/api/account/login" && req.method === "POST") {
      let code="";
      try{code=normalizeAccountCode((await req.json()).code);}catch{}
      if(!isValidNewCode(code))return jsonNoStore({error:"Μη έγκυρος κωδικός."},401);
      const limit=await limitAccountLogin(req,env,code);
      if(!limit.ok)return jsonNoStore({error:"Έγιναν πολλές προσπάθειες. Δοκίμασε ξανά αργότερα."},429);
      const account=await resolveAccount(code,env);
      if(!account)return jsonNoStore({error:"Δεν βρέθηκε λογαριασμός με αυτόν τον κωδικό."},401);
      return jsonNoStore({scope:account.scope,session:await newSession(account.stub,account.scope)});
    }

    if (url.pathname === "/api/account/session" && req.method === "POST") {
      const account=await getAccount(req,env);
      return account?jsonNoStore({scope:account.scope}):
        jsonNoStore({error:"Η σύνδεση έχει λήξει. Συνδέσου ξανά."},401);
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

    // Account-protected file vault: all operations use the same authenticated
    // Durable Object as this account's service history.
    if (url.pathname==="/api/documents"||url.pathname.startsWith("/api/documents/")) {
      const account=await getAccount(req,env);
      if(!account)return jsonNoStore({error:"Η σύνδεση έληξε. Συνδέσου ξανά."},401);
      const suffix=url.pathname.slice("/api/documents".length);
      if(suffix&&!/^\/[0-9a-f-]{36}(?:\/chunk\/[0-9]{1,3}|\/complete)?$/.test(suffix))
        return jsonNoStore({error:"Μη έγκυρη διαδρομή εγγράφου."},404);
      if(!["GET","POST","PUT","DELETE"].includes(req.method))
        return jsonNoStore({error:"Method not allowed"},405);
      if(req.method==="PUT"&&Number(req.headers.get("Content-Length")||"0")>DOCUMENT_CHUNK)
        return jsonNoStore({error:"Το τμήμα είναι πολύ μεγάλο."},413);
      // The caller's bearer token NEVER reaches document storage; the Worker
      // verified it before forwarding to its account-specific Durable Object.
      const forwarded=new Request("https://car-data.internal/docs"+suffix,{
        method:req.method,
        headers:{"Content-Type":req.headers.get("Content-Type")||"application/octet-stream"},
        ...(req.method==="GET"?{}:{body:await req.arrayBuffer()})
      });
      return account.stub.fetch(forwarded);
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

    if(url.pathname==="/docs"||url.pathname.startsWith("/docs/"))
      return handlePrivateDocuments(request,this.state);
    if(url.pathname==="/login-check"&&request.method==="POST"){
      let data={};
      try{data=await request.json();}catch{}
      const ip=String(data.ip||"unknown").slice(0,80);
      const codeHash=String(data.codeHash||"");
      if(!/^[a-f0-9]{64}$/.test(codeHash))return json({error:"invalid code"},400);
      const now=Date.now();
      const allowed=await this.state.storage.transaction(async tx=>{
        const checks=[
          {key:"login-ip:"+ip,max:12},
          {key:"login-code:"+codeHash,max:15}
        ];
        const pending=[];
        for(const check of checks){
          const row=(await tx.get(check.key))||{since:now,count:0};
          if(now-row.since>3600000){row.since=now;row.count=0;}
          if(row.count>=check.max)return false;
          row.count++;pending.push([check.key,row]);
        }
        for(const [key,row] of pending)await tx.put(key,row);
        return true;
      });
      return json({ok:allowed},allowed?200:429);
    }
    if(url.pathname==="/session-issue"&&request.method==="POST"){
      let secret="";
      try{secret=String((await request.json()).secret||"");}catch{}
      if(!/^[A-F0-9]{48}$/.test(secret))return json({error:"invalid session"},400);
      const existing=await this.state.storage.get("dataset");
      if(!existing)return json({error:"account missing"},404);
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(secret))),b=>b.toString(16).padStart(2,"0")).join("");
      await this.state.storage.put("session:"+digest,Date.now()+30*86400000);
      return json({ok:true});
    }
    if(url.pathname==="/session-verify"&&request.method==="POST"){
      let secret="";
      try{secret=String((await request.json()).secret||"");}catch{}
      if(!/^[A-F0-9]{48}$/.test(secret))return json({error:"invalid session"},401);
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(secret))),b=>b.toString(16).padStart(2,"0")).join("");
      const expires=await this.state.storage.get("session:"+digest);
      return json({ok:!!expires&&expires>Date.now()},expires&&expires>Date.now()?200:401);
    }
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

    if(url.pathname==="/legacy-auth"&&request.method==="GET"){
      const dataset=await this.state.storage.get("dataset");
      const requiresSession=await this.state.storage.get("sessionRequired");
      return json({legacy:!!dataset&&!requiresSession},
        dataset&&!requiresSession?200:401);
    }

    if (url.pathname === "/create-account" && request.method === "POST") {
      const created=await this.state.storage.transaction(async tx=>{
        if(await tx.get("dataset"))return false;
        await tx.put("dataset",{items:[],settings:{},reminders:[],revision:1});
        await tx.put("sessionRequired",true);
        return true;
      });
      return json({ok:created},created?201:409);
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
