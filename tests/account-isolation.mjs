/* Run with Node 20+: node tests/account-isolation.mjs */
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const backend=read("src/index.js")
  .replace('import {handleDiagnosticRequest} from "./diagnostics.js";',"")
  .replace("export default {","const Worker = {")
  .replace("export class CarServiceStore","class CarServiceStore");
const {Worker,CarServiceStore}=new Function(
  "crypto","TextEncoder","Request","Response","URL","handleDiagnosticRequest",
  backend+";return {Worker,CarServiceStore};"
)(webcrypto,TextEncoder,Request,Response,URL,()=>{throw new Error("AI not expected")});
const dataMap=new Map();
const objects=new Map();
const ns={
  idFromName:name=>name,
  get(id){
    if(!objects.has(id)){
      const data=new Map();
      const storage={
        async get(key){return data.get(key)},
        async put(key,value){data.set(key,value)},
        async transaction(fn){return fn(this)}
      };
      const store=new CarServiceStore({storage},{});
      objects.set(id,{fetch:(url,opts)=>store.fetch(new Request(url,opts))});
      dataMap.set(id,data);
    }
    return objects.get(id);
  }
};
const env={
  CAR_DATA:ns,
  PASSCODE:"legacy-password-for-test",
  DATA:{get:async()=>null},
  AI:{run:async()=>({response:""})},
  ASSETS:{fetch:async()=>new Response("not found",{status:404})}
};
const base="https://service.example";
const call=async(path,method="GET",body=null,code=null,ip="192.0.2.5")=>{
  const headers={"CF-Connecting-IP":ip};
  if(body!==null)headers["Content-Type"]="application/json";
  if(code)headers.Authorization="Bearer "+code;
  const req=new Request(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
  return Worker.fetch(req,env);
};
const asJSON=async response=>({status:response.status,data:await response.json()});
const a=await asJSON(await call("/api/account/create","POST",{}));
const b=await asJSON(await call("/api/account/create","POST",{}));
assert.equal(a.status,200);
assert.equal(b.status,200);
assert.match(a.data.code,/^[0-9]{4}$/);
assert.match(a.data.session,/^ST-[a-f0-9]{64}-[A-F0-9]{48}$/);
assert(!a.data.code.startsWith("CS-"),"Generated codes do not require CS-");
assert.notEqual(a.data.code,b.data.code);
assert.notEqual(a.data.scope,b.data.scope);
assert.equal((await asJSON(await call("/api/account/login","POST",{code:a.data.code}))).data.scope,a.data.scope);
assert.equal((await call("/api/account/login","POST",{code:"CS-"+"0".repeat(32)})).status,401);
assert.equal((await call("/api/data")).status,401);
assert.equal((await call("/api/diagnose","POST",{},null)).status,401);
assert.equal((await call("/api/parse","POST",{text:"broken"},null)).status,401);
const loginA=a.data.session,loginB=b.data.session;
assert.equal((await call("/api/data","GET",null,a.data.code)).status,401,
  "A bare four-digit PIN must not authorize the data API");
assert.equal((await call("/api/account/session","POST",{},loginA)).status,200);
// A chosen code must be unique: creating again must NOT grant access to its owner.
const custom="1234";
const own=await asJSON(await call("/api/account/create","POST",{code:custom}));
assert.equal(own.status,200);
assert.equal(own.data.code,custom);
assert.notEqual(own.data.scope,a.data.scope);
assert.equal((await asJSON(await call("/api/account/login","POST",{code:custom.toLowerCase()}))).data.scope,own.data.scope);
const customAuth=own.data.session;
assert.equal((await call("/api/data","GET",null,custom)).status,401);
assert.equal((await call("/api/data","GET",null,customAuth)).status,200);
const hijack=await asJSON(await call("/api/account/create","POST",{code:custom}));
assert.equal(hijack.status,409,"Existing code cannot create/login to another account");
assert.notEqual(hijack.data.scope,own.data.scope);
const veryShort=await asJSON(await call("/api/account/create","POST",{code:"123"}));
assert.equal(veryShort.status,200,"User-selected codes may be shorter than 4 digits");
assert.equal((await call("/api/data","GET",null,"123")).status,401,"Short raw codes cannot bypass login");
const onlyLetters=await asJSON(await call("/api/account/create","POST",{code:"ONLYLETTERSAREHERE"}));
assert.equal(onlyLetters.status,200,"Letter-only codes are allowed");
assert.equal((await call("/api/data","GET",null,"ONLYLETTERSAREHERE")).status,401,
  "Long newly created codes must use sessions, not raw bearer access");
const greek=await asJSON(await call("/api/account/create","POST",{code:"12345678ςς"}));
assert.equal(greek.status,200);
assert.equal(greek.data.code,"12345678ΣΣ");
assert.equal((await call("/api/account/create","POST",{code:"12345678ΣΣ"})).status,409,
  "Unicode uppercase canonicalization must prevent duplicates");
assert.equal((await asJSON(await call("/api/account/login","POST",{code:"12345678ςς"}))).data.scope,
  greek.data.scope,"Greek code should log in");
assert.equal((await call("/api/data","GET",null,"12345678ΣΣ")).status,401,
  "Greek raw code must not authorize data access");
assert.equal((await call("/api/data","GET",null,greek.data.session)).status,200);
// Emulate an existing four-digit account created in v11 before sessionRequired.
const priorFourDigit="9090";
const oldPinHashBytes=await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(priorFourDigit));
const oldPinScope=Array.from(new Uint8Array(oldPinHashBytes),
  b=>b.toString(16).padStart(2,"0")).join("");
await ns.get("car-service-user-"+oldPinScope).fetch("https://car-data.internal/bootstrap",{
  method:"POST",body:JSON.stringify({items:[{notes:"existing PIN account"}],
    settings:{},reminders:[]})
});
assert.equal((await call("/api/data","GET",null,priorFourDigit)).status,401,
  "Old 4-digit PINs must not bypass login throttling");
const oldPinLogin=await asJSON(await call("/api/account/login","POST",{code:priorFourDigit}));
assert.equal(oldPinLogin.status,200);
assert.equal((await asJSON(await call("/api/data","GET",null,oldPinLogin.data.session))).data.items[0].notes,
  "existing PIN account");

assert.equal((await call("/api/account/create","POST",{code:"   "})).status,400);
assert.equal((await call("/api/account/create","POST",{code:"ABC\u200B123"})).status,400,
  "Invisible Unicode characters are rejected");
assert.equal((await call("/api/account/create","POST",{code:"A".repeat(65)})).status,400,
  "Technical maximum length is enforced");
assert.equal((await call("/api/data","GET",null,"1234")).status,401);
assert.equal((await call("/api/data","GET",null,customAuth)).status,200);
// Old CS- accounts created by v9 must continue working without migration.
const legacyGenerated="CS-"+"A".repeat(32);
const digest=await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(legacyGenerated));
const oldScope=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
await ns.get("car-service-user-"+oldScope).fetch("https://car-data.internal/bootstrap",{
  method:"POST",body:JSON.stringify({items:[{id:"old-CS-user",notes:"old v9 account"}],
    settings:{},reminders:[]})
});
const oldSession=await asJSON(await call("/api/account/login","POST",{code:legacyGenerated}));
assert.equal(oldSession.status,200,"Existing CS- codes must remain valid");
assert.equal(oldSession.data.scope,oldScope);
assert.equal((await asJSON(await call("/api/data","GET",null,legacyGenerated))).data.items[0].id,"old-CS-user");


const initialA=await asJSON(await call("/api/data","GET",null,loginA));
const initialB=await asJSON(await call("/api/data","GET",null,loginB));
assert.deepEqual(initialA.data.items,[]);
assert.deepEqual(initialB.data.items,[]);
const update={
  items:[{id:"unique-service-A",date:"2026-11-22",km:"155000",notes:"private A"}],
  settings:{vehicleProfile:{make:"Ford",model:"Focus"}},
  reminders:[],
  revision:initialA.data.revision
};
assert.equal((await call("/api/data","PUT",update,loginA)).status,200);
const seenA=await asJSON(await call("/api/data","GET",null,loginA));
const seenB=await asJSON(await call("/api/data","GET",null,loginB));
assert.equal(seenA.data.items[0].notes,"private A");
assert.deepEqual(seenB.data.items,[]);
assert.deepEqual(seenB.data.settings,{});
const seenCustom=await asJSON(await call("/api/data","GET",null,customAuth));
assert.deepEqual(seenCustom.data.items,[],"A user-created code must have its own empty dataset");
// New custom account cannot write into or overwrite other users' history.
const customInitial=seenCustom.data.revision;
const customWrite={items:[{id:"custom-1",notes:"private custom"}],
  settings:{current:"123000"},reminders:[],revision:customInitial};
assert.equal((await call("/api/data","PUT",customWrite,customAuth)).status,200);
assert.equal((await asJSON(await call("/api/data","GET",null,loginA))).data.items[0].notes,"private A");
assert.equal((await asJSON(await call("/api/data","GET",null,loginB))).data.items.length,0);
assert.equal((await call("/api/data","PUT",{...update,revision:seenA.data.revision},loginB)).status,409);
assert.equal((await asJSON(await call("/api/data","GET",null,loginA))).data.items.length,1);
// Set up previous single-user data, then migrate to an unused third account.
const legacy=ns.get("car-service-primary");
await legacy.fetch("https://car-data.internal/bootstrap",{
  method:"POST",body:JSON.stringify({items:[{id:"old-1",notes:"old private"}],
  settings:{current:"160000"},reminders:[]})
});
const c=await asJSON(await call("/api/account/create","POST",{}));
assert.equal(c.status,200);
assert.equal((await call("/api/account/migrate","POST",{legacyCode:"bad"},c.data.session)).status,403);
const migration=await call("/api/account/migrate","POST",{legacyCode:env.PASSCODE},c.data.session);
assert.equal(migration.status,200);
const migrated=await asJSON(await call("/api/data","GET",null,c.data.session));
assert.equal(migrated.data.items[0].notes,"old private");
assert.equal(migrated.data.settings.current,"160000");
assert.deepEqual((await asJSON(await call("/api/data","GET",null,loginB))).data.items,[]);
const again=await call("/api/account/migrate","POST",{legacyCode:env.PASSCODE},loginB);
assert.equal(again.status,409);
assert.equal((await call("/api/account/migrate","POST",{legacyCode:env.PASSCODE},c.data.session)).status,200);
assert.equal((await asJSON(await call("/api/data","GET",null,loginA))).data.items[0].id,"unique-service-A");

// PINs cannot bypass the login flow by being passed directly to any endpoint.
assert.equal((await call("/api/parse","POST",{text:"hello"},"1234")).status,401);
assert.equal((await call("/api/diagnose","POST",{},"1234")).status,401);
const secondPin=await asJSON(await call("/api/account/create","POST",{code:"5678"}));
assert.equal(secondPin.status,200);
assert.notEqual(secondPin.data.scope,own.data.scope);
assert.deepEqual((await asJSON(await call("/api/data","GET",null,secondPin.data.session))).data.items,[]);
// A different client's guessing is throttled without disabling valid sessions.
let throttled;
for(let i=0;i<14;i++){
  throttled=await call("/api/account/login","POST",{code:String(6000+i)},null,"203.0.113.99");
}
assert.equal(throttled.status,429);
assert.equal((await call("/api/data","GET",null,customAuth)).status,200);

const html=read("public/index.html"),features=read("public/features.js"),ai=read("public/ai-mechanic.js");
const account=read("public/account.js"),sw=read("public/sw.js");
assert(html.includes('const ACCOUNT_SESSION_KEY="carServiceActiveAccountV3";'));
assert(html.includes('KEY="carServiceLog:"+scope'));
assert(html.includes('BASEKEY="carServiceSyncBaseV2:"+scope'));
assert(html.includes('PENDINGKEY="carServiceSyncPendingV2:"+scope'));
assert(html.includes('id="accountGate"'));
assert(!html.includes('load();resetForm();render();sync();'));
assert(features.includes('"carServiceDraftV1:"+window.CarHistoryAccountScope'));
assert(ai.includes('"carServiceAiConversationV1:"+window.CarHistoryAccountScope'));
assert(account.includes('localStorage.removeItem(ACTIVE)'));
assert(account.includes('accountCustomForm'));
assert(account.includes('const codeValid=code=>'),"Flexible code validation must be used");
assert(html.includes('id="accountCustomCode"'));
assert(html.includes('id="accountOpenRegister"'),"Registration must be a separate action");
assert(html.includes('id="accountLoginPanel" class="account-panel"'),"Login panel should be focused");
assert(html.includes('id="accountRegisterPanel" class="account-panel" hidden'),"Registration hidden at first");
assert(html.includes('id="accountBackToLogin"'),"Can return to login");
assert(account.includes('showPanel("register")'),"Registration opens on demand");
assert(html.includes('id="accountCustomCreate"'));
assert(html.includes('type="password" autocomplete="off"'),"Login works with digits and letters");
assert(!html.includes('id="accountLegacyMode"'),"The login field supports old and new codes directly");
assert(html.includes('maxlength="64" placeholder="π.χ. 1234 ή 12345678ςς"'));
assert(!/id="accountCustomCode"[^>]*pattern=/.test(html),"No mandatory 4-digit validation on account creation");
assert(account.includes('normalize("NFKC")'),"Client must normalize Greek/Unicode codes");
assert(html.includes('id="accountCustomForm"'));
assert(sw.includes("carhistory-shell-v16")&&sw.includes('"/account.js"'));
for(const script of [account,features,ai])assert.doesNotThrow(()=>new Function(script));
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(script[1].trim())assert.doesNotThrow(()=>new Function(script[1]));
}
console.log("PASS: flexible Greek/Latin/numeric codes, uniqueness, sessions, throttling, isolation and legacy migration");
