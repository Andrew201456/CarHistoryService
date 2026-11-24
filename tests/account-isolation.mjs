/* Run with Node 20+: node tests/account-isolation.mjs
 * Username/password account isolation and in-place migration.
 * This test uses NON-PRODUCTION legacy passwords/scopes.
 */
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const digest=async text=>Array.from(new Uint8Array(
  await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(text))
),b=>b.toString(16).padStart(2,"0")).join("");
const sample={
  ANDREAS:"TEST-PREVIOUS-PASSWORD-ALPHA",
  NICK:"TEST-PREVIOUS-PASSWORD-BRAVO",
  VASDIM:"TEST-PREVIOUS-PASSWORD-CHARLIE"
};
const scopes=Object.fromEntries(await Promise.all(
  Object.entries(sample).map(async([name,pass])=>[name,await digest(pass)])
));
const original=read("src/index.js");
assert(original.includes('["ANDREAS"')&&original.includes('["NICK"')&&
  original.includes('["VASDIM"'),"All three migration identities must be reserved");
assert(original.includes("CAR_MASTER_ADMIN"),"Master secret gate is required");
let backend=original.replace(
  /const LEGACY_USER_SCOPES=new Map\(\[[\s\S]*?\]\);/,
  'const LEGACY_USER_SCOPES=new Map('+JSON.stringify(Object.entries(scopes))+');'
).replace('import {handleDiagnosticRequest} from "./diagnostics.js";',"")
 .replace("export default {","const Worker = {")
 .replace("export class CarServiceStore","class CarServiceStore");
const {Worker,CarServiceStore}=new Function(
  "crypto","TextEncoder","Request","Response","URL","ReadableStream","handleDiagnosticRequest",
  backend+";return {Worker,CarServiceStore};"
)(webcrypto,TextEncoder,Request,Response,URL,ReadableStream,
  ()=>{throw Error("AI not expected")});
const maps=new Map(),objects=new Map();
const namespace={
  idFromName:name=>name,
  get(key){
    if(!objects.has(key)){
      const values=new Map();
      const storage={
        async get(k){return values.get(k)},
        async put(k,v){values.set(k,v)},
        async delete(k){values.delete(k)},
        async list({prefix}){return new Map([...values].filter(([k])=>k.startsWith(prefix)))},
        async transaction(fn){return fn(this)}
      };
      const doStore=new CarServiceStore({storage},{});
      objects.set(key,{fetch:(url,options)=>doStore.fetch(new Request(url,options))});
      maps.set(key,values);
    }
    return objects.get(key);
  }
};
const env={
  CAR_DATA:namespace,
  CAR_MASTER_ADMIN:"TEST-MASTER-ONLY-DO-NOT-USE-2026",
  PASSCODE:"old-shared-code-for-test",
  DATA:{get:async()=>null},AI:{run:async()=>({})},
  ASSETS:{fetch:async()=>new Response("missing",{status:404})}
};
const call=(path,method="GET",payload=null,session="",ip="192.0.2.41")=>{
  const headers={"CF-Connecting-IP":ip};
  if(session)headers.Authorization="Bearer "+session;
  if(payload!==null)headers["Content-Type"]="application/json";
  return Worker.fetch(new Request("https://example.test"+path,{
    method,headers,body:payload===null?undefined:JSON.stringify(payload)
  }),env);
};
const json=async response=>({status:response.status,data:await response.json()});
const docId="11111111-2222-4333-8444-555555555555";
const oldTokens={};
for(const [user,password] of Object.entries(sample)){
  const scope=scopes[user],account=namespace.get("car-service-user-"+scope);
  const history={
    items:[{id:"historic-"+user,notes:"DO NOT LOSE "+user}],
    settings:{current:user==="ANDREAS"?"156000":"143000"},
    reminders:[{id:"reminder-"+user,name:"Service"}]
  };
  assert.equal((await account.fetch("https://internal/bootstrap",{
    method:"POST",body:JSON.stringify(history)
  })).status,200);
  const attachment={
    id:docId,kind:"insurance",title:"Original "+user,expiry:"2027-11-22",
    cost:240,fileName:"insurance.pdf",mime:"application/pdf",size:3,parts:1,
    status:"ready",createdAt:Date.now(),clientKey:"historic-"+user
  };
  maps.get("car-service-user-"+scope).set("car-doc:meta:"+docId,attachment);
  maps.get("car-service-user-"+scope).set("car-doc:part:"+docId+":0",new Uint8Array([1,2,3]));
  const secret="A".repeat(47)+String(Object.keys(oldTokens).length);
  await account.fetch("https://internal/session-issue",{
    method:"POST",body:JSON.stringify({secret})
  });
  oldTokens[user]="ST-"+scope+"-"+secret;
}
assert.equal((await call("/api/data")).status,401);
assert.equal((await call("/api/account/create","POST",{
  username:"Andreas",password:"longpassword123",masterAdmin:env.CAR_MASTER_ADMIN
})).status,409,"Reserved username cannot create a blank replacement");
assert.equal((await call("/api/account/login","POST",{
  username:"Andreas",password:sample.ANDREAS
})).status,428,"Legacy identity cannot be claimed with password alone");
const badMaster=await json(await call("/api/account/login","POST",{
  username:"Andreas",password:sample.ANDREAS,masterAdmin:"bad-master"
}));
assert.equal(badMaster.status,403);
assert.equal(badMaster.data.masterError,"mismatch");
assert.match(badMaster.data.error,/δεν ταιριάζει/);
const correctMaster=env.CAR_MASTER_ADMIN;
env.CAR_MASTER_ADMIN="short";
const shortMaster=await json(await call("/api/account/login","POST",{
  username:"Andreas",password:sample.ANDREAS,masterAdmin:"short"
}));
assert.equal(shortMaster.status,503);
assert.equal(shortMaster.data.masterError,"configuration");
assert.match(shortMaster.data.error,/10 χαρακτήρες/);
env.CAR_MASTER_ADMIN="tenChars01"; // exactly 10 characters
assert.equal(env.CAR_MASTER_ADMIN.length,10);

const logins={};
for(const [name,password] of Object.entries(sample)){
  const data={
    username:name.toLowerCase(),password,
    ...(name==="ANDREAS"?{legacySession:oldTokens[name]}:
      {masterAdmin:env.CAR_MASTER_ADMIN})
  };
  const logged=await json(await call("/api/account/login","POST",data,null,
    "192.0.2."+String(50+Object.keys(logins).length)));
  assert.equal(logged.status,200,"First login must activate "+name);
  assert.equal(logged.data.scope,scopes[name],"History scope must remain unchanged");
  logins[name]=logged.data;
  const history=await json(await call("/api/data","GET",null,logged.data.session));
  assert.equal(history.data.items[0].notes,"DO NOT LOSE "+name);
  assert.equal(history.data.reminders[0].id,"reminder-"+name);
  const docs=await json(await call("/api/documents","GET",null,logged.data.session));
  assert.equal(docs.data.documents[0].title,"Original "+name);
  assert.equal((await call("/api/data","GET",null,oldTokens[name])).status,401,
    "Pre-migration sessions must be revoked");
}
assert.notEqual(logins.ANDREAS.scope,logins.NICK.scope);
assert.notEqual(logins.NICK.scope,logins.VASDIM.scope);
assert.equal((await call("/api/data","GET",null,"a-different-token")).status,401);
assert.equal((await call("/api/data","GET",null,sample.ANDREAS)).status,401,
  "A raw password must never authorize account data");
const again=await json(await call("/api/account/login","POST",{
  username:"aNdReAs",password:sample.ANDREAS
},null,"192.0.2.76"));
assert.equal(again.status,200,"Subsequent login should not require master");
assert.equal(again.data.scope,scopes.ANDREAS);

const createdWrong=await call("/api/account/create","POST",{
  username:"FreshUser",password:"really-long-password",masterAdmin:"invalid"
});
assert.equal(createdWrong.status,403);
const fresh=await json(await call("/api/account/create","POST",{
  username:"FreshUser",password:"really-long-password",
  masterAdmin:env.CAR_MASTER_ADMIN
}));
assert.equal(fresh.status,201);
assert.equal(fresh.data.username,"FRESHUSER");
assert(!("password" in fresh.data),"Passwords must not be returned from registration");
assert.notEqual(fresh.data.scope,scopes.ANDREAS);
assert.equal((await call("/api/account/create","POST",{
  username:"freshuser",password:"different-password",
  masterAdmin:env.CAR_MASTER_ADMIN
})).status,409);
assert.deepEqual((await json(await call("/api/data","GET",null,fresh.data.session))).data.items,[]);
assert.equal((await call("/api/account/login","POST",{
  username:"FreshUser",password:"wrong-password"
},null,"192.0.2.79")).status,401);
assert.equal((await call("/api/account/login","POST",{
  username:"freshUSER",password:"really-long-password"
},null,"192.0.2.80")).status,200);

const replaced=await json(await call("/api/account/password","POST",{
  username:"Andreas",currentPassword:sample.ANDREAS,
  newPassword:"long-rotated-password-2026!"
},logins.ANDREAS.session));
assert.equal(replaced.status,200);
assert.equal(replaced.data.scope,scopes.ANDREAS);
assert.equal((await call("/api/data","GET",null,logins.ANDREAS.session)).status,401,
  "Changing password must revoke old sessions");
assert.equal((await call("/api/account/login","POST",{
  username:"Andreas",password:sample.ANDREAS
},null,"192.0.2.81")).status,401);
const changed=await json(await call("/api/account/login","POST",{
  username:"Andreas",password:"long-rotated-password-2026!"
},null,"192.0.2.82"));
assert.equal(changed.status,200);
assert.equal((await json(await call("/api/data","GET",null,changed.data.session))).data.items[0].id,
  "historic-ANDREAS");
assert.equal((await json(await call("/api/documents","GET",null,changed.data.session))).data.documents[0].title,
  "Original ANDREAS");
assert.equal((await call("/api/data","GET",null,logins.NICK.session)).status,200);
assert.equal((await call("/api/data","GET",null,logins.VASDIM.session)).status,200);
// During troubleshooting repeated login attempts must not return HTTP 429.
for(let i=0;i<18;i++){
  const attempt=await call("/api/account/login","POST",{
    username:"SomeUnknownUser",password:"not-the-right-password"
  },null,"203.0.113.52");
  assert.equal(attempt.status,401,"Temporary debugging mode must not lock out login");
}
// The original protection remains explicitly restorable without another code commit.
env.CAR_LOGIN_LIMIT_ENABLED="true";
let throttled=null;
for(let i=0;i<14;i++)
  throttled=await call("/api/account/login","POST",{
    username:"AnotherUnknownUser",password:"not-the-right-password"
  },null,"203.0.113.74");
assert.equal(throttled.status,429,"Opt-in login throttle should still work");
delete env.CAR_LOGIN_LIMIT_ENABLED;
console.log("PASS: master-gated accounts, 3 in-place history/document migrations, temporary unlimited debugging logins and restorable throttling");
