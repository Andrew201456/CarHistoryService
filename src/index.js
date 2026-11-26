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
// fixed length or CS- prefix. Legacy codes are NOT accepted on data routes.
// Account sessions are expiring; login throttle is temporarily opt-in.
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
/* Username/password identity records are stored in SEPARATE per-username
   Durable Objects; account data remains in its existing per-account DO.
   Converting a legacy PIN links the existing scope; never copies or clears data. */
const LEGACY_USER_SCOPES=new Map([
  ["ANDREAS","03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"],
  ["NICK","9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0"],
  ["VASDIM","c1f330d0aff31c1c87403f1e4347bcc21aff7c179908723535f2b31723702525"]
]);
const LOGIN_USER_RE=/^[A-Z][A-Z0-9._-]{1,31}$/;
const cleanUsername=s=>String(s||"").trim().normalize("NFKC").toUpperCase();
const validUser=s=>LOGIN_USER_RE.test(s);
const validPassword=s=>typeof s==="string"&&[...s].length>=4&&[...s].length<=128&&
 !/[\u0000-\u001f\u007f]/.test(s);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const unhex=s=>new Uint8Array(s.match(/../g).map(v=>parseInt(v,16)));
const safeEqual=(a,b)=>{
  if(typeof a!=="string"||typeof b!=="string")return false;
  const A=new TextEncoder().encode(a),B=new TextEncoder().encode(b);
  let diff=A.length^B.length;
  for(let i=0;i<Math.max(A.length,B.length);i++)diff|=(A[i]||0)^(B[i]||0);
  return diff===0;
};
const passwordSalt=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
async function passwordVerifier(password,salt){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),
    "PBKDF2",false,["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({
    name:"PBKDF2",hash:"SHA-256",salt:unhex(salt),iterations:100000
  },key,256)));
}
const identityStub=(env,username)=>env.CAR_DATA.get(
  env.CAR_DATA.idFromName("car-service-identity-"+username));
const identityFetch=(stub,action,body)=>stub.fetch("https://car-data.internal/identity/"+action,{
  method:"POST",body:JSON.stringify(body)
});
const accountScopeStub=(env,scope)=>env.CAR_DATA.get(
  env.CAR_DATA.idFromName("car-service-user-"+scope));
// Private, non-authoritative account directory in existing DATA KV.
// Authentication stays in the per-username identity Durable Object.
// Never duplicate password verifiers, salts, session tokens or scope IDs.
const accountIndexKey=username=>"accounts:"+username;
function indexDate(value){
  return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
}
async function indexAccount(env,username,{expectedScope=null,loginAt=null,onlyIfMissing=false}={}){
  if(!validUser(username)||typeof env.DATA?.put!=="function")return;
  try{
    const key=accountIndexKey(username);
    const previous=await env.DATA.get(key,"json");
    if(onlyIfMissing&&previous?.username===username)return;
    const response=await identityFetch(identityStub(env,username),"describe",{});
    if(!response.ok)return;
    const identity=await response.json();
    if(identity.username!==username||(expectedScope&&identity.scope!==expectedScope))return;
    const now=new Date().toISOString();
    const old=previous?.username===username?previous:{};
    const entry={
      username,
      createdAt:indexDate(identity.createdAt)||null,
      firstIndexedAt:indexDate(old.firstIndexedAt)||now,
      lastLoginAt:[indexDate(old.lastLoginAt),indexDate(loginAt)].filter(Boolean).sort().at(-1)||null,
      passwordUpdatedAt:indexDate(identity.passwordUpdatedAt)||null,
      passwordStorage:"PBKDF2-SHA256 (identity Durable Object)"
    };
    if(JSON.stringify(old)!==JSON.stringify(entry))await env.DATA.put(key,JSON.stringify(entry));
  }catch{
    // Registry outages must not break logins or existing user data.
    console.warn("Account directory update temporarily unavailable");
  }
}
async function indexKnownAccounts(env,exclude=""){
  await Promise.allSettled([...LEGACY_USER_SCOPES.keys()]
    .filter(username=>username!==exclude)
    .map(username=>indexAccount(env,username,{onlyIfMissing:true})));
}
function updateAccountDirectory(ctx,env,username,options={}){
  // Keep the login response fast; Cloudflare waitUntil completes the index
  // writes after the response. Tests without an execution context can await.
  const work=Promise.allSettled([
    indexAccount(env,username,options),
    indexKnownAccounts(env,username)
  ]);
  if(ctx?.waitUntil){ctx.waitUntil(work);return Promise.resolve();}
  return work;
}


const ADMIN_AUDIT_DAYS=30*86400000;
const ADMIN_AUDIT_MAX=500;
const auditStub=env=>env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-admin-audit-v1"));
function auditIP(req){
  const ip=req.headers.get("CF-Connecting-IP")||"";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip)?ip:null;
}
function recordAccountLogin(ctx,env,req,username,kind){
  const event={username,kind,at:new Date().toISOString(),ip:auditIP(req),
    country:/^[A-Z]{2}$/.test(req.cf?.country||"")?req.cf.country:null};
  const work=Promise.resolve().then(async()=>{
    const res=await auditStub(env).fetch("https://car-data.internal/admin-audit/record",{method:"POST",body:JSON.stringify(event)});
    if(!res.ok)throw Error("audit unavailable");
  }).catch(()=>console.warn("Account audit temporarily unavailable"));
  if(ctx?.waitUntil){ctx.waitUntil(work);return Promise.resolve();}
  return work;
}
async function adminOverview(req,env){
  // A dedicated admin secret takes precedence. Existing installations can
  // use their already configured master credential without copying secrets.
  const dedicated=env.CAR_ADMIN_PASSWORD;
  const adminPassword=dedicated===undefined||dedicated===null
    ?env.CAR_MASTER_ADMIN:dedicated;
  // Admin sign-in accepts any nonempty configured secret. This does not
  // change the separate master-password rules for account registration.
  if(typeof adminPassword!=="string"||!adminPassword.length||adminPassword.length>256)
    return jsonNoStore({error:"Λείπει ή δεν είναι έγκυρος ο κωδικός διαχειριστή (CAR_MASTER_ADMIN / CAR_ADMIN_PASSWORD)."},503);
  if(req.headers.get("Origin")&&req.headers.get("Origin")!==new URL(req.url).origin)
    return jsonNoStore({error:"Μη επιτρεπτή προέλευση."},403);
  if(!req.headers.get("Content-Type")?.startsWith("application/json"))
    return jsonNoStore({error:"Μη έγκυρο αίτημα."},415);
  const length=Number(req.headers.get("Content-Length")||0);
  if(length>4096)return jsonNoStore({error:"Μη έγκυρο αίτημα."},413);
  let supplied,payload;
  try{
    const reader=req.body.getReader(),decoder=new TextDecoder();let body="",total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>4096){await reader.cancel();return jsonNoStore({error:"Μη έγκυρο αίτημα."},413);}
      body+=decoder.decode(value,{stream:true});}
    body+=decoder.decode();payload=JSON.parse(body);supplied=payload.password;
  }catch{return jsonNoStore({error:"Μη έγκυρο αίτημα."},400);}
  if(typeof supplied!=="string"||supplied.length>256)return jsonNoStore({error:"Λάθος κωδικός."},401);
  try{
    const ipHash=await sha256(auditIP(req)||"unknown");
    const gate=await auditStub(env).fetch("https://car-data.internal/admin-audit/gate",{method:"POST",body:JSON.stringify({ipHash})});
    if(!gate.ok)return jsonNoStore({error:"Πολλές προσπάθειες. Δοκίμασε αργότερα."},gate.status===429?429:503);
    if(!safeEqual(await sha256(supplied),await sha256(adminPassword)))
      return jsonNoStore({error:"Λάθος κωδικός."},401);
    const action=new URL(req.url).pathname;
    if(action==="/api/admin/create")return await adminCreateAccount(env,payload);
    if(action==="/api/admin/delete")return await adminDeleteAccount(env,payload);
    const response=await auditStub(env).fetch("https://car-data.internal/admin-audit/read");
    if(!response.ok)throw Error("audit unavailable");
    const {events,deleted=[]}=await response.json(),accounts=new Map(),removed=new Set(deleted);
    const add=(username,row={})=>{
      if(!validUser(username)||removed.has(username))return;
      const old=accounts.get(username)||{};
      accounts.set(username,{username,createdAt:indexDate(row.createdAt)||old.createdAt||null,
        lastLoginAt:[indexDate(row.lastLoginAt),old.lastLoginAt].filter(Boolean).sort().at(-1)||null,
        passwordUpdatedAt:indexDate(row.passwordUpdatedAt)||old.passwordUpdatedAt||null});
    };
    let cursor,partial=false;
    for(let n=0;n<1;n++){
      const page=await env.DATA.list({prefix:"accounts:",limit:25,...(cursor?{cursor}:{})});
      for(const key of page.keys){
        const username=key.name.slice("accounts:".length);
        if(validUser(username)){
          const value=await env.DATA.get(key.name,"json");
          if(value?.username===username)add(username,value);
        }
      }
      if(page.list_complete)break;
      cursor=page.cursor;
      partial=true;break;
    }
    // Old accounts may not yet be in eventually consistent KV. Only include real identities.
    for(const username of LEGACY_USER_SCOPES.keys()){
      const res=await identityFetch(identityStub(env,username),"describe",{});
      if(res.ok){const value=await res.json();if(value.username===username){add(username,value);await indexAccount(env,username,{onlyIfMissing:true});}}
      else if(res.status!==404&&res.status!==410)partial=true;
    }
    for(const event of events)add(event.username,{lastLoginAt:event.at});
    return jsonNoStore({accounts:[...accounts.values()].sort((a,b)=>a.username.localeCompare(b.username)),events,partial,retentionDays:30,maxEvents:ADMIN_AUDIT_MAX});
  }catch{return jsonNoStore({error:"Προσωρινή αδυναμία ανάγνωσης διαχείρισης."},503);}
}
async function adminCreateAccount(env,payload){
  const username=cleanUsername(payload.username),password=payload.newPassword;
  if(!validUser(username)||!validPassword(password))
    return jsonNoStore({error:"Username 2–32 χαρακτήρες (λατινικά) και password 4–128 χαρακτήρες."},400);
  if(LEGACY_USER_SCOPES.has(username))
    return jsonNoStore({error:"Το username είναι δεσμευμένο."},409);
  const registry=identityStub(env,username);
  const exists=await identityFetch(registry,"exists",{});
  if(exists.ok)return jsonNoStore({error:"Το username χρησιμοποιείται ή έχει διαγραφεί."},409);
  if(exists.status!==404)return jsonNoStore({error:"Δεν ήταν δυνατός ο έλεγχος του username."},503);
  const salt=passwordSalt(),verifier=await passwordVerifier(password,salt);
  const scope=await sha256("new-car-account:"+crypto.randomUUID()+crypto.randomUUID());
  const stub=accountScopeStub(env,scope);
  const created=await stub.fetch("https://car-data.internal/create-account",{method:"POST"});
  if(!created.ok)return jsonNoStore({error:"Δεν δημιουργήθηκε ο λογαριασμός."},503);
  const claimed=await identityFetch(registry,"create",{username,scope,salt,verifier});
  if(!claimed.ok){
    if(claimed.status===409)await stub.fetch("https://car-data.internal/account-purge",{method:"POST"});
    return jsonNoStore({error:claimed.status===409?"Το username χρησιμοποιείται ή έχει διαγραφεί.":"Η δημιουργία χρειάζεται έλεγχο."},claimed.status===409?409:503);
  }
  await indexAccount(env,username,{expectedScope:scope});
  const desc=await identityFetch(registry,"describe",{});
  const row=desc.ok?await desc.json():{};
  return jsonNoStore({ok:true,account:{username,createdAt:indexDate(row.createdAt),lastLoginAt:null,passwordUpdatedAt:indexDate(row.passwordUpdatedAt)}},201);
}
async function adminDeleteAccount(env,payload){
  const username=cleanUsername(payload.username);
  if(!validUser(username)||payload.confirmed!==true||payload.confirmUsername!==username)
    return jsonNoStore({error:"Απαιτούνται δύο επιβεβαιώσεις και το ακριβές username."},400);
  const registry=identityStub(env,username);
  const marked=await identityFetch(registry,"delete",{username});
  if(marked.status===404)return jsonNoStore({error:"Ο λογαριασμός δεν βρέθηκε."},404);
  if(!marked.ok)return jsonNoStore({error:"Η διαγραφή δεν ολοκληρώθηκε. Δοκίμασε ξανά."},503);
  const {scope}=await marked.json();
  if(!/^[a-f0-9]{64}$/.test(scope||""))return jsonNoStore({error:"Μη έγκυρος λογαριασμός."},503);
  // The identity is now disabled. Retrying uses the same immutable scope.
  const purged=await accountScopeStub(env,scope).fetch("https://car-data.internal/account-purge",{method:"POST"});
  if(!purged.ok)return jsonNoStore({error:"Ο λογαριασμός απενεργοποιήθηκε. Επανάλαβε τη διαγραφή για τον καθαρισμό των δεδομένων."},503);
  const forgotten=await auditStub(env).fetch("https://car-data.internal/admin-audit/forget",{method:"POST",body:JSON.stringify({username})});
  if(!forgotten.ok)return jsonNoStore({error:"Τα δεδομένα διαγράφηκαν. Επανάλαβε για τον καθαρισμό του μητρώου."},503);
  try{await env.DATA.delete(accountIndexKey(username));}
  catch{return jsonNoStore({ok:true,warning:"Ο λογαριασμός διαγράφηκε. Η παλιά καταχώριση KV μπορεί να παραμένει προσωρινά."});}
  return jsonNoStore({ok:true});
}
async function pruneAdminAudit(storage){
  return storage.transaction(async tx=>{
    const previous=await tx.get("admin-audit-events")||[];
    const events=previous.filter(e=>Date.parse(e.at)>Date.now()-ADMIN_AUDIT_DAYS).slice(0,ADMIN_AUDIT_MAX);
    if(events.length!==previous.length)await tx.put("admin-audit-events",events);
    return events;
  });
}
async function scheduleAdminAudit(storage,events){
  if(typeof storage.setAlarm!=="function")return;
  if(events.length)await storage.setAlarm(Math.max(Date.now()+1000,Date.parse(events.at(-1).at)+ADMIN_AUDIT_DAYS+1000));
  else if(typeof storage.deleteAlarm==="function")await storage.deleteAlarm();
}

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
    const saved=await storage.transaction(async tx=>{if(await tx.get("account-deleted"))return false;await tx.put(docKey(id),meta);return true;});
    if(!saved)return jsonDocument({error:"account deleted"},401);
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
    const saved=await storage.transaction(async tx=>{if(await tx.get("account-deleted"))return false;await tx.put(docPart(id,index),new Uint8Array(bytes));return true;});
    if(!saved)return jsonDocument({error:"account deleted"},401);
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
    const saved=await storage.transaction(async tx=>{if(await tx.get("account-deleted"))return false;await tx.put(docKey(id),meta);return true;});
    if(!saved)return jsonDocument({error:"account deleted"},401);
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
    if(result.status===401)return null;
    if(!result.ok)throw new Error("Session verification temporarily unavailable");
    return {stub,scope};
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
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if(["/api/admin/overview","/api/admin/create","/api/admin/delete"].includes(url.pathname))return req.method==="POST"?adminOverview(req,env):jsonNoStore({error:"Μη επιτρεπτή μέθοδος."},405);

    // Every account uses a separate SQLite Durable Object. A code for another
    // account CANNOT select, read or write this account's data.
    if (url.pathname === "/api/account/create" && req.method === "POST") {
      let payload={};
      try{payload=await req.json();}catch{}
      const username=cleanUsername(payload.username),password=payload.password,
        master=String(payload.masterAdmin||"");
      if(!validUser(username)||!validPassword(password))
        return jsonNoStore({error:"Βάλε username 2–32 χαρακτήρων και password τουλάχιστον 4 χαρακτήρων."},400);
      // These three identities are reserved for the existing account scopes.
      // They can ONLY be activated through their original PIN and /login.
      if(LEGACY_USER_SCOPES.has(username))
        return jsonNoStore({error:"Αυτός ο χρήστης έχει ήδη ιστορικό. Κάνε σύνδεση."},409);
      const limiter=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-registration-limit"));
      const allowed=await limiter.fetch("https://car-data.internal/limit",{
        method:"POST",body:JSON.stringify({ip:req.headers.get("CF-Connecting-IP")||"unknown"})
      });
      if(!allowed.ok)return jsonNoStore({error:"Πολλές προσπάθειες. Δοκίμασε αργότερα."},429);
      if(typeof env.CAR_MASTER_ADMIN!=="string"||env.CAR_MASTER_ADMIN.length<10)
        return jsonNoStore({error:"Το CAR_MASTER_ADMIN στο Cloudflare λείπει ή έχει λιγότερους από 10 χαρακτήρες. Ρύθμισέ το ως Production Secret."},503);
      if(!safeEqual(master,env.CAR_MASTER_ADMIN))
        return jsonNoStore({error:"Λάθος master admin κωδικός."},403);
      const registry=identityStub(env,username);
      const exists=await identityFetch(registry,"exists",{});
      if(exists.ok)return jsonNoStore({error:"Αυτό το username χρησιμοποιείται ήδη."},409);
      // Random scope prevents password/username-derived account enumeration.
      const scope=await sha256("new-car-account:"+crypto.randomUUID()+crypto.randomUUID());
      const stub=accountScopeStub(env,scope);
      const created=await stub.fetch("https://car-data.internal/create-account",{
        method:"POST",body:JSON.stringify({items:[],settings:{},reminders:[]})
      });
      if(!created.ok)return jsonNoStore({error:"Δεν δημιουργήθηκε ο λογαριασμός."},503);
      const salt=passwordSalt(),verifier=await passwordVerifier(password,salt);
      const claimed=await identityFetch(registry,"create",{username,scope,salt,verifier});
      if(claimed.status===409)return jsonNoStore({error:"Το username χρησιμοποιείται ήδη."},409);
      if(!claimed.ok)return jsonNoStore({error:"Δεν ολοκληρώθηκε η εγγραφή."},503);
      const session=await newSession(stub,scope);
      await updateAccountDirectory(ctx,env,username,{expectedScope:scope,loginAt:new Date().toISOString()});
      await recordAccountLogin(ctx,env,req,username,"create");
      return jsonNoStore({username,scope,session},201);
    }

    if (url.pathname === "/api/account/login" && req.method === "POST") {
      let payload={};
      try{payload=await req.json();}catch{}
      const username=cleanUsername(payload.username),password=payload.password;
      if(!validUser(username)||!validPassword(password))
        return jsonNoStore({error:"Λάθος username ή password."},401);
      // Temporary debugging mode (off by default): account login attempts
      // are not throttled. Set CAR_LOGIN_LIMIT_ENABLED="true" in Cloudflare
      // when troubleshooting is complete to restore IP/username limits.
      if(env.CAR_LOGIN_LIMIT_ENABLED==="true"){
        const limited=await limitAccountLogin(req,env,username);
        if(!limited.ok)return jsonNoStore({error:"Πολλές προσπάθειες σύνδεσης. Δοκίμασε αργότερα."},429);
      }
      const registry=identityStub(env,username);
      const validated=await identityFetch(registry,"authenticate",{password});
      let scope=null;
      if(validated.ok){
        scope=(await validated.json()).scope;
      }else if(validated.status===404&&LEGACY_USER_SCOPES.has(username)){
        // First login attaches the username to the exact historical DO.
        // The PIN must match the expected legacy scope hash and the DO must
        // already contain a dataset. Never create an empty replacement.
        const legacyScope=LEGACY_USER_SCOPES.get(username);
        if(!safeEqual(await sha256(normalizeAccountCode(password)),legacyScope))
          return jsonNoStore({error:"Λάθος username ή password."},401);
        const old=accountScopeStub(env,legacyScope);
        const existing=await old.fetch("https://car-data.internal/data");
        if(!existing.ok)
          return jsonNoStore({error:"Το παλιό ιστορικό δεν βρέθηκε στο Cloudflare. Δεν δημιουργήθηκε άδειος λογαριασμός."},409);
        // First-time activation requires proof of an existing authenticated
        // session from that exact historical account OR the owner's master
        // secret. A leaked four-digit PIN alone cannot claim a legacy vault.
        let proven=false;
        const legacy=SESSION_RE.exec(String(payload.legacySession||""));
        if(legacy&&legacy[1]===legacyScope){
          const checked=await old.fetch("https://car-data.internal/session-verify",{
            method:"POST",body:JSON.stringify({secret:legacy[2]})
          });
          proven=checked.ok;
        }
        if(!proven){
          // A missing or too-short configured secret is a server setup issue,
          // not an incorrect login password. Give a diagnostic status without
          // disclosing any secret value or attempting to compare insecurely.
          if(typeof env.CAR_MASTER_ADMIN!=="string"||env.CAR_MASTER_ADMIN.length<10)
            return jsonNoStore({
              error:"Το CAR_MASTER_ADMIN στο Cloudflare λείπει ή έχει λιγότερους από 10 χαρακτήρες. Ρύθμισέ το ως Production Secret.",
              masterRequired:true,masterError:"configuration"
            },503);
          const supplied=String(payload.masterAdmin||"");
          if(!supplied)
            return jsonNoStore({
              error:"Για την πρώτη ενεργοποίηση συμπλήρωσε τον master admin κωδικό που όρισες στο Cloudflare.",
              masterRequired:true,masterError:"missing"
            },428);
          if(!safeEqual(supplied,env.CAR_MASTER_ADMIN))
            return jsonNoStore({
              error:"Ο master admin κωδικός δεν ταιριάζει με το Cloudflare Secret. Έλεγξε ακριβώς τους χαρακτήρες και το Production environment.",
              masterRequired:true,masterError:"mismatch"
            },403);
          proven=true;
        }
        const salt=passwordSalt(),verifier=await passwordVerifier(password,salt);
        const claimed=await identityFetch(registry,"create",{username,scope:legacyScope,salt,verifier});
        if(!claimed.ok&&claimed.status!==409)
          return jsonNoStore({error:"Δεν ολοκληρώθηκε η μεταφορά. Δοκίμασε ξανά."},503);
        if(claimed.status===409){
          const retry=await identityFetch(registry,"authenticate",{password});
          if(!retry.ok)return jsonNoStore({error:"Λάθος username ή password."},401);
          scope=(await retry.json()).scope;
        }else{
          scope=legacyScope;
          // Old sessions cannot continue to read personal documents.
          await old.fetch("https://car-data.internal/sessions-revoke",{method:"POST"});
        }
      }else{
        return jsonNoStore({error:"Λάθος username ή password."},401);
      }
      const account=accountScopeStub(env,scope);
      const data=await account.fetch("https://car-data.internal/data");
      if(!data.ok)return jsonNoStore({error:"Το ιστορικό του λογαριασμού δεν είναι διαθέσιμο."},503);
      const session=await newSession(account,scope);
      await updateAccountDirectory(ctx,env,username,{expectedScope:scope,loginAt:new Date().toISOString()});
      await recordAccountLogin(ctx,env,req,username,"login");
      return jsonNoStore({username,scope,session});
    }

    if (url.pathname === "/api/account/password" && req.method === "POST") {
      const account=await getAccount(req,env);
      if(!account)return jsonNoStore({error:"Η σύνδεση έχει λήξει."},401);
      let payload={};
      try{payload=await req.json();}catch{}
      const username=cleanUsername(payload.username);
      if(!validUser(username)||!validPassword(payload.currentPassword)||
         !validPassword(payload.newPassword))
        return jsonNoStore({error:"Μη έγκυρος κωδικός. Χρειάζονται τουλάχιστον 4 χαρακτήρες."},400);
      if(payload.newPassword===payload.currentPassword)
        return jsonNoStore({error:"Ο νέος κωδικός πρέπει να διαφέρει."},400);
      const registry=identityStub(env,username);
      const changed=await identityFetch(registry,"change",{
        scope:account.scope,
        currentPassword:payload.currentPassword,
        newPassword:payload.newPassword
      });
      if(!changed.ok)return jsonNoStore({error:"Λάθος τωρινός κωδικός."},401);
      await account.stub.fetch("https://car-data.internal/sessions-revoke",{method:"POST"});
      const session=await newSession(account.stub,account.scope);
      await updateAccountDirectory(ctx,env,username,{expectedScope:account.scope});
      return jsonNoStore({username,scope:account.scope,session});
    }

    if (url.pathname === "/api/account/session" && req.method === "POST") {
      try{
        const account=await getAccount(req,env);
        if(!account)return jsonNoStore({error:"Η σύνδεση έχει λήξει. Συνδέσου ξανά."},401);
        // The browser can propose a username, but the identity must resolve
        // to this exact authenticated account before it is indexed.
        let payload={};
        try{payload=await req.json();}catch{}
        const username=cleanUsername(payload?.username);
        await updateAccountDirectory(ctx,env,username,{expectedScope:account.scope});
        return jsonNoStore({scope:account.scope});
      }catch{
        return jsonNoStore({error:"Ο έλεγχος σύνδεσης δεν είναι προσωρινά διαθέσιμος."},503);
      }
    }

    // Read-only incident diagnostic. Never changes any Durable Object,
    // even when the identity points at the wrong account scope. The master
    // secret and an authenticated session are both required.
    if (url.pathname === "/api/account/recovery-check" && req.method === "POST") {
      const account=await getAccount(req,env);
      if(!account)return jsonNoStore({error:"Συνδέσου πρώτα στον λογαριασμό."},401);
      let body={};
      try{body=await req.json();}catch{}
      const username=cleanUsername(body.username);
      if(!LEGACY_USER_SCOPES.has(username))
        return jsonNoStore({error:"Ο έλεγχος αφορά τους αρχικούς λογαριασμούς."},400);
      if(typeof env.CAR_MASTER_ADMIN!=="string"||env.CAR_MASTER_ADMIN.length<10||
         !safeEqual(String(body.masterAdmin||""),env.CAR_MASTER_ADMIN))
        return jsonNoStore({error:"Απαιτείται ο σωστός master admin κωδικός για τον ασφαλή έλεγχο."},403);
      const describe=await identityFetch(identityStub(env,username),"describe",{});
      if(!describe.ok)return jsonNoStore({error:"Δεν βρέθηκε το username στον ενεργό Worker."},404);
      const identity=await describe.json();
      if(identity.scope!==account.scope||identity.username!==username)
        return jsonNoStore({error:"Ο λογαριασμός σύνδεσης δεν αντιστοιχεί στο username."},403);
      const snapshot=async stub=>{
        const data=await stub.fetch("https://car-data.internal/data");
        const payload=data.ok?await data.json():null;
        const docResult=await stub.fetch("https://car-data.internal/docs");
        const docs=docResult.ok?await docResult.json():null;
        return {
          exists:!!payload,
          entries:payload?.items?.length||0,
          reminders:payload?.reminders?.length||0,
          savedFields:Object.keys(payload?.settings||{}).length,
          documents:docs?.documents?.length||0,
          revision:payload?.revision||0
        };
      };
      const expectedScope=LEGACY_USER_SCOPES.get(username);
      const legacy=accountScopeStub(env,expectedScope);
      const primary=env.CAR_DATA.get(env.CAR_DATA.idFromName("car-service-primary"));
      const [active,original,shared]=await Promise.all([
        snapshot(account.stub),
        expectedScope===account.scope?snapshot(account.stub):snapshot(legacy),
        snapshot(primary)
      ]);
      return jsonNoStore({
        username,
        sameOriginalAccount:account.scope===expectedScope,
        active,original,
        sharedLegacy:shared,
        warning:"Έλεγχος μόνο για ανάγνωση. Καμία μεταφορά ή αντικατάσταση δεν εκτελέστηκε."
      });
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

    // Authenticated, in-memory service-book photo transcription. Images are
    // never saved by this endpoint and the bearer token is never sent to AI.
    if (url.pathname === "/api/parse-image" && req.method === "POST") {
      if(!(await getAccount(req,env)))
        return jsonNoStore({error:"Συνδέσου πρώτα στον λογαριασμό σου."},401);
      const length=Number(req.headers.get("Content-Length")||0);
      if(length>3_300_000)
        return jsonNoStore({error:"Η φωτογραφία είναι πολύ μεγάλη. Μείωσε το μέγεθός της."},413);
      let body={};
      try{body=await req.json();}catch{
        return jsonNoStore({error:"Μη έγκυρη φωτογραφία."},400);
      }
      const image=body?.image;
      if(typeof image!=="string"||image.length>3_100_000||
         !/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(image)||
         image.length<200)
        return jsonNoStore({error:"Επίλεξε καθαρή φωτογραφία JPG, PNG ή WebP."},400);
      const photoPrompt=`Διάβασε μόνο το κείμενο που διακρίνεις σε αυτή τη φωτογραφία βιβλίου service, απόδειξης συνεργείου ή σελίδας με εγγραφές συντήρησης αυτοκινήτου.
Μετέγραψε στα ελληνικά αναλυτικά κάθε πραγματική εγγραφή που είναι ορατή: ημερομηνία, χιλιόμετρα, εργασίες, ανταλλακτικά, τιμές, συνεργείο, παρατηρήσεις.
Διατήρησε τη σχέση κάθε ημερομηνίας με τις εργασίες της. Αν βλέπεις πολλά service, ξεχώρισέ τα.
ΜΗΝ μαντεύεις ή συμπληρώνεις κομμένα ή δυσανάγνωστα πεδία. Γράψε [δυσανάγνωστο] όπου χρειάζεται.
Αγνόησε πλαίσια, διακοσμήσεις και άσχετες επιγραφές. Μόνο απλή μεταγραφή, όχι JSON.`;
      try{
        const vision=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{
          messages:[{role:"user",content:photoPrompt}],
          image,max_tokens:2000,temperature:0
        });
        let text=typeof vision==="string"?vision:vision?.response||"";
        if(typeof text!=="string")text=String(text||"");
        text=text.trim().slice(0,11500);
        if(!text||text.length<7)
          return jsonNoStore({error:"Δεν διαβάστηκε κείμενο. Δοκίμασε πιο καθαρή φωτογραφία."},422);
        return jsonNoStore({text});
      }catch(error){
        console.error("Service-book vision error",String(error?.message||error));
        return jsonNoStore({
          error:"Δεν ήταν διαθέσιμη η ανάγνωση φωτογραφίας. Έλεγξε ότι έχει ενεργοποιηθεί το Cloudflare Vision model και η άδειά του."
        },502);
      }
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

  async alarm(){
    const events=await pruneAdminAudit(this.state.storage);
    await scheduleAdminAudit(this.state.storage,events);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const json = (data, status = 200) =>
      Response.json(data, { status, headers: { "Cache-Control": "no-store" } });


    // Only the Worker can reach these internal Durable Object routes.
    if(url.pathname.startsWith("/admin-audit/")){
      const storage=this.state.storage;
      if(url.pathname==="/admin-audit/gate"&&request.method==="POST"){
        const {ipHash}=await request.json();
        if(typeof ipHash!=="string"||!/^[a-f0-9]{64}$/.test(ipHash))return json({},400);
        const allowed=await storage.transaction(async tx=>{
          const now=Date.now(),old=await tx.get("admin-audit-gate");
          const gate=old&&now-old.since<600000&&old.ips?old:{since:now,attempts:0,ips:{}};
          if(gate.attempts>=300||(gate.ips[ipHash]||0)>=30)return false;
          gate.attempts++;gate.ips[ipHash]=(gate.ips[ipHash]||0)+1;
          await tx.put("admin-audit-gate",gate);return true;
        });
        return json({ok:allowed},allowed?200:429);
      }
      if(url.pathname==="/admin-audit/record"&&request.method==="POST"){
        const e=await request.json();
        if(!validUser(e.username)||!indexDate(e.at)||!["create","login"].includes(e.kind))return json({},400);
        const event={username:e.username,kind:e.kind,at:e.at,
          ip:typeof e.ip==="string"&&/^[0-9a-fA-F:.]{3,45}$/.test(e.ip)?e.ip:null,
          country:typeof e.country==="string"&&/^[A-Z]{2}$/.test(e.country)?e.country:null};
        const events=await storage.transaction(async tx=>{
          const old=await tx.get("admin-audit-events")||[];
          if(await tx.get("admin-deleted:"+e.username))return old;
          const next=[event,...old.filter(v=>Date.parse(v.at)>Date.now()-ADMIN_AUDIT_DAYS)]
            .sort((a,b)=>b.at.localeCompare(a.at)).slice(0,ADMIN_AUDIT_MAX);
          await tx.put("admin-audit-events",next);return next;
        });
        await scheduleAdminAudit(storage,events);
        return json({ok:true});
      }
      if(url.pathname==="/admin-audit/forget"&&request.method==="POST"){
        const {username}=await request.json();
        if(!validUser(username))return json({},400);
        const events=await storage.transaction(async tx=>{
          await tx.put("admin-deleted:"+username,true);
          const next=(await tx.get("admin-audit-events")||[]).filter(e=>e.username!==username);
          await tx.put("admin-audit-events",next);return next;
        });
        await scheduleAdminAudit(storage,events);return json({ok:true});
      }
      if(url.pathname==="/admin-audit/read"&&request.method==="GET"){
        const events=await pruneAdminAudit(storage);
        await scheduleAdminAudit(storage,events);const deleted=[...(await storage.list({prefix:"admin-deleted:"})).keys()].map(k=>k.slice("admin-deleted:".length));return json({events,deleted});
      }
      return json({},404);
    }

    if(url.pathname==="/account-purge"&&request.method==="POST"){
      const storage=this.state.storage;
      await storage.put("account-deleted",true);
      // Remove all live account data, documents and sessions in bounded batches.
      // Retain only the tombstone so stale clients cannot revive the vault.
      while(true){
        const rows=await storage.list({limit:16});
        const keys=[...rows.keys()].filter(k=>k!=="account-deleted");
        if(!keys.length)break;
        await storage.delete(keys);
      }
      return json({ok:true});
    }
    if(await this.state.storage.get("account-deleted"))
      return json({error:"account deleted"},401);

    if(url.pathname==="/docs"||url.pathname.startsWith("/docs/"))
      return handlePrivateDocuments(request,this.state);
    if(url.pathname.startsWith("/identity/")&&request.method==="POST"){
      const action=url.pathname.slice("/identity/".length);
      const identity=await this.state.storage.get("identity");
      if(action==="exists")return json({exists:!!identity},identity?200:404);
      if(action==="describe")
        return identity?.deletedAt?json({error:"deleted"},410):identity?json({username:identity.username,scope:identity.scope,
          createdAt:identity.createdAt||null,passwordUpdatedAt:identity.passwordUpdatedAt||null}):
          json({error:"not found"},404);
      let input={};
      try{input=await request.json();}catch{}
      if(action==="delete"){
        if(!validUser(input.username))return json({},400);
        const removed=await this.state.storage.transaction(async tx=>{
          const latest=await tx.get("identity");
          if(!latest||latest.username!==input.username)return null;
          if(!latest.deletedAt)await tx.put("identity",{username:latest.username,scope:latest.scope,deletedAt:new Date().toISOString()});
          return {scope:latest.scope};
        });
        return removed?json(removed):json({},404);
      }
      if(identity?.deletedAt)return json({error:"deleted"},410);
      if(action==="create"){
        if(!validUser(input.username)||!/^[a-f0-9]{64}$/.test(input.scope||"")||
           !/^[a-f0-9]{32}$/.test(input.salt||"")||
           !/^[a-f0-9]{64}$/.test(input.verifier||""))
          return json({error:"invalid identity"},400);
        const created=await this.state.storage.transaction(async tx=>{
          if(await tx.get("identity"))return false;
          await tx.put("identity",{
            username:input.username,scope:input.scope,
            salt:input.salt,verifier:input.verifier,
            createdAt:new Date().toISOString(),passwordUpdatedAt:new Date().toISOString()
          });return true;
        });
        return json({ok:created},created?201:409);
      }
      if(action==="authenticate"){
        if(!identity)return json({error:"not found"},404);
        if(!validPassword(input.password))return json({error:"invalid login"},401);
        const candidate=await passwordVerifier(input.password,identity.salt);
        if(!safeEqual(candidate,identity.verifier))return json({error:"invalid login"},401);
        return json({scope:identity.scope});
      }
      if(action==="change"){
        if(!identity)return json({error:"not found"},404);
        if(!validPassword(input.currentPassword)||!validPassword(input.newPassword)||
          !safeEqual(identity.scope,String(input.scope||"")))
          return json({error:"invalid change"},401);
        const old=await passwordVerifier(input.currentPassword,identity.salt);
        if(!safeEqual(old,identity.verifier))return json({error:"invalid login"},401);
        const salt=passwordSalt(),verifier=await passwordVerifier(input.newPassword,salt);
        const updated=await this.state.storage.transaction(async tx=>{
          const latest=await tx.get("identity");
          if(!latest||latest.deletedAt||latest.verifier!==identity.verifier)return false;
          await tx.put("identity",{...latest,salt,verifier,passwordUpdatedAt:new Date().toISOString()});return true;
        });
        return json({ok:updated},updated?200:409);
      }
      return json({error:"not found"},404);
    }
    if(url.pathname==="/sessions-revoke"&&request.method==="POST"){
      const epoch=(await this.state.storage.get("sessionEpoch"))||0;
      await this.state.storage.transaction(async tx=>{
        await tx.put("sessionEpoch",epoch+1);
        // Disable legacy long-form raw bearer codes after adopting username
        // authentication, even for accounts originally created before sessions.
        await tx.put("sessionRequired",true);
      });
      return json({ok:true});
    }
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
      const issued=await this.state.storage.transaction(async tx=>{
        if(await tx.get("account-deleted")||!await tx.get("dataset"))return false;
        await tx.put("session:"+digest,{expires:Date.now()+30*86400000,epoch:(await tx.get("sessionEpoch"))||0});
        return true;
      });
      return json({ok:issued},issued?200:401);
    }
    if(url.pathname==="/session-verify"&&request.method==="POST"){
      let secret="";
      try{secret=String((await request.json()).secret||"");}catch{}
      if(!/^[A-F0-9]{48}$/.test(secret))return json({error:"invalid session"},401);
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(secret))),b=>b.toString(16).padStart(2,"0")).join("");
      const session=await this.state.storage.get("session:"+digest);
      const epoch=(await this.state.storage.get("sessionEpoch"))||0;
      const expiry=typeof session==="number"?session:session?.expires||0;
      const issuedEpoch=typeof session==="number"?0:session?.epoch??-1;
      const valid=expiry>Date.now()&&issuedEpoch===epoch;
      return json({ok:valid},valid?200:401);
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
        if(await tx.get("account-deleted")||!current||current.revision!==1||current.items.length||
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
        if(await tx.get("account-deleted")||await tx.get("dataset"))return false;
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
        if (current||await tx.get("account-deleted")) return;
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
      if (await tx.get("account-deleted")||!current) return { status: 409, body: { error: "not initialized" } };
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
