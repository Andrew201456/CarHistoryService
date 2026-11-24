/* Run: node tests/account-login-ui.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const html=readFileSync(resolve(root,"public/index.html"),"utf8");
const script=readFileSync(resolve(root,"public/account.js"),"utf8");
assert(html.includes('id="accountRememberMe"'));
assert(html.includes('id="accountRestoreBoot"'));
const css=readFileSync(resolve(root,"public/ui.css"),"utf8");
const embedded=html.match(/<script id="accountLoginRuntime">([\s\S]*?)<\/script>/);
assert(embedded,"Login runtime must be embedded to avoid stale PWA JS");
assert.equal(embedded[1].trim(),script.trim());
const critical=html.match(/<style id="accountCriticalStyles">([\s\S]*?)<\/style>/);
assert(critical&&critical[1].includes(".account-options-trigger svg"));
assert(css.includes(".account-card [hidden]{display:none!important}"));
for(const id of ["accountGate","accountLoginForm","accountUsername","accountPassword",
  "accountLoginBtn","accountLoginBtnText","accountRegisterPanel","accountBackToLogin",
  "accountCustomForm","accountCustomUsername","accountCustomPassword",
  "accountMasterAdmin","accountLoginMasterWrap","accountLoginMaster",
  "accountCustomCreate","accountPasswordForm",
  "accountCurrentPassword","accountNewPassword","accountChangePassword"]){
  assert(html.includes('id="'+id+'"'),"Missing "+id);
}
assert(!html.includes('id="accountCode"'),"Old PIN-only login must be removed");
assert(!html.includes('id="accountCreate"'),"Unrestricted random-PIN registration removed");
assert(!script.includes("LEGACY_USER="),"Do not expose legacy login credentials in public JS");
assert(!script.includes('password:current.password'),"Password must never be persisted");

class Element{
  constructor(id,hidden=false){
    this.id=id;this.hidden=hidden;this.value="";this.textContent="";
    this.disabled=false;this.checked=false;this.listeners={};this.attributes={};
    this.classList={toggle(){},remove(){}};
  }
  setAttribute(k,v){this.attributes[k]=String(v)}
  removeAttribute(k){delete this.attributes[k]}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({preventDefault(){}})}
  focus(){this.focused=true}
}
const scope="f".repeat(64),session="ST-"+scope+"-"+"B".repeat(48);
const updatedSession="ST-"+scope+"-"+"C".repeat(48);
function mount(initial=null,{source="local"}={}){
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const el=Object.fromEntries(ids.map(id=>{
    const match=html.match(new RegExp('<[^>]+\\bid="'+id+'"[^>]*>'))?.[0]||"";
    const e=new Element(id,/\shidden(?:\s|>|=)/.test(match));
    e.checked=/\schecked(?:\s|>|=)/.test(match);
    return [id,e];
  }));
  const data=new Map(),tabData=new Map();
  if(initial)(source==="session"?tabData:data).set("carServiceActiveAccountV3",JSON.stringify(initial));
  const localStorage={
    getItem:k=>data.get(k)||null,
    setItem:(k,v)=>data.set(k,v),
    removeItem:k=>data.delete(k)
  };
  const sessionStorage={getItem:k=>tabData.get(k)||null,setItem:(k,v)=>tabData.set(k,v),removeItem:k=>tabData.delete(k)};
  const sent=[],started=[],state={reloaded:0,restoring:false};
  const fetch=async (url,options)=>{
    const body=JSON.parse(options.body||"{}");
    sent.push({url,body,headers:options.headers});
    if(url==="/api/account/login"){
      if(body.password==="wrong")
        return {ok:false,status:401,json:async()=>({error:"Λάθος username ή password."})};
      if(body.username==="VASDIM"&&body.masterAdmin==="incorrect-admin-code")
        return {ok:false,status:403,json:async()=>({
          error:"Ο master admin κωδικός δεν ταιριάζει με το Cloudflare Secret.",
          masterRequired:true,masterError:"mismatch"
        })};
      if(body.username==="VASDIM"&&body.masterAdmin!=="SECRET-FOR-TEST-ONLY")
        return {ok:false,status:428,json:async()=>({
          error:"Για την πρώτη ενεργοποίηση συμπλήρωσε τον master admin κωδικό.",
          masterRequired:true,masterError:"missing"
        })};
      return {ok:true,status:200,json:async()=>({username:body.username,scope,session})};
    }
    if(url==="/api/account/create"){
      if(body.masterAdmin!=="SECRET-FOR-TEST-ONLY")
        return {ok:false,status:403,json:async()=>({error:"Λάθος master admin κωδικός."})};
      return {ok:true,status:201,json:async()=>({username:body.username,scope,session})};
    }
    if(url==="/api/account/session")return {
      ok:true,status:200,json:async()=>({scope})
    };
    if(url==="/api/account/password")return {
      ok:true,status:200,json:async()=>({scope,session:updatedSession})
    };
    throw Error("Unexpected route "+url);
  };
  const document={getElementById:id=>el[id],body:{classList:{remove(){}}},documentElement:{classList:{remove(k){if(k==="account-restoring")state.restoring=false;}}}};
  const win={CarAppStartAccount:(token,which)=>started.push({token,scope:which}),
    addEventListener(){}};
  const AbortControllerStub=class{
    constructor(){this.signal={aborted:false,addEventListener(){},removeEventListener(){}}}
    abort(){this.signal.aborted=true}
  };
  new Function("document","window","localStorage","sessionStorage","fetch","navigator",
    "location","prompt","alert","confirm","AbortController",
    "setTimeout","clearTimeout",script)(
    document,win,localStorage,sessionStorage,fetch,
    {clipboard:{writeText:async()=>{}}},
    {reload(){state.reloaded++}},()=>{},()=>{},()=>true,
    AbortControllerStub,()=>1,()=>{}
  );
  return {el,localStorage,sessionStorage,started,sent,state};
}

const returning=mount();
assert.equal(returning.el.accountLoginPanel.hidden,false);
assert.equal(returning.el.accountRegisterPanel.hidden,true);
returning.el.accountUsername.value="Andreas";
returning.el.accountPassword.value="wrong";
await returning.el.accountLoginForm.fire("submit");
assert.match(returning.el.accountMessage.textContent,/Λάθος username/);
assert.equal(returning.el.accountLoginBtn.disabled,false);
returning.el.accountPassword.value="UI-TEST-PASSWORD";
await returning.el.accountLoginForm.fire("submit");
assert.equal(returning.started.length,1);
assert.equal(returning.started[0].scope,scope);
assert.equal(returning.sent.at(-1).body.username,"ANDREAS");
assert.equal(returning.sent.at(-1).body.password,"UI-TEST-PASSWORD");
assert.equal(returning.el.accountPassword.value,"");
const persistent=JSON.parse(returning.localStorage.getItem("carServiceActiveAccountV3"));
assert.equal(persistent.username,"ANDREAS");
assert.equal(persistent.scope,scope);
assert.equal(persistent.session,session);
assert(!JSON.stringify(persistent).includes("UI-TEST-PASSWORD"),"No password in localStorage");

const bootScript=html.match(/<script id="accountRestoreBoot">([\\s\\S]*?)<\\/script>/)?.[1];
assert(bootScript,"Prepaint session boot script missing");
function testBoot(sessionArea,localArea){
  const classes=new Set();
  const document={documentElement:{classList:{add:k=>classes.add(k)}}};
  const storage=map=>({getItem:k=>map.get(k)||null});
  new Function("document","sessionStorage","localStorage",bootScript)(
    document,storage(sessionArea),storage(localArea));
  return classes.has("account-restoring");
}
const savedAccount={username:"ANDREAS",scope,session};
assert.equal(testBoot(new Map(),new Map([["carServiceActiveAccountV3",
  JSON.stringify(savedAccount)]])),true,
  "Remembered account should hide login before browser first paint");
assert.equal(testBoot(new Map([["carServiceActiveAccountV3",
  JSON.stringify(savedAccount)]]),new Map()),true,
  "Existing same-tab session should also avoid login flash");
assert.equal(testBoot(new Map(),new Map()),false,
  "No saved session should display login normally");
assert(html.includes("html.account-restoring body.account-locked .account-gate"));

const optional=mount();
assert.equal(optional.el.accountRememberMe.checked,true);
optional.el.accountRememberMe.checked=false;
optional.el.accountUsername.value="Andreas";
optional.el.accountPassword.value="UI-TEST-PASSWORD";
await optional.el.accountLoginForm.fire("submit");
assert.equal(optional.localStorage.getItem("carServiceActiveAccountV3"),null,
  "Unchecked remember-me should not persist login across browser restarts");
assert.equal(JSON.parse(optional.sessionStorage.getItem("carServiceActiveAccountV3")).scope,scope);
const sameTab=mount({username:"ANDREAS",scope,session},{source:"session"});
for(let i=0;i<30;i++)await Promise.resolve();
assert.equal(sameTab.started.length,1);
assert.equal(sameTab.el.accountRememberMe.checked,false);
const legacyFirstLogin=mount();
legacyFirstLogin.el.accountUsername.value="Vasdim";
legacyFirstLogin.el.accountPassword.value="UI-TEST-LEGACY-PASSWORD";
assert.equal(legacyFirstLogin.el.accountLoginMasterWrap.hidden,true);
await legacyFirstLogin.el.accountLoginForm.fire("submit");
assert.equal(legacyFirstLogin.el.accountLoginMasterWrap.hidden,false,
  "Legacy activation should request master only when required");
assert.match(legacyFirstLogin.el.accountMessage.textContent,/master admin/);
legacyFirstLogin.el.accountLoginMaster.value="incorrect-admin-code";
await legacyFirstLogin.el.accountLoginForm.fire("submit");
assert.match(legacyFirstLogin.el.accountMessage.textContent,/δεν ταιριάζει/);
assert.equal(legacyFirstLogin.el.accountLoginMaster.value,"",
  "Incorrect master must be cleared");
legacyFirstLogin.el.accountLoginMaster.value="SECRET-FOR-TEST-ONLY";
await legacyFirstLogin.el.accountLoginForm.fire("submit");
assert.equal(legacyFirstLogin.started.length,1);
assert.equal(legacyFirstLogin.el.accountLoginMasterWrap.hidden,true);
assert.equal(legacyFirstLogin.el.accountLoginMaster.value,"");
assert(!JSON.stringify(legacyFirstLogin.localStorage.getItem("carServiceActiveAccountV3"))
  .includes("SECRET-FOR-TEST-ONLY"),"Master secret must never persist");

const register=mount();
await register.el.accountOpenRegister.fire("click");
assert.equal(register.el.accountRegisterPanel.hidden,false);
assert.equal(register.el.accountLoginPanel.hidden,true);
register.el.accountCustomUsername.value="Nikos";
register.el.accountCustomPassword.value="secure-password-123!";
register.el.accountMasterAdmin.value="incorrect";
await register.el.accountCustomForm.fire("submit");
assert.match(register.el.accountMessage.textContent,/master admin/);
assert.equal(register.el.accountGate.hidden,false);
register.el.accountMasterAdmin.value="SECRET-FOR-TEST-ONLY";
await register.el.accountCustomForm.fire("submit");
assert.equal(register.started.length,1);
assert.equal(register.sent.at(-1).body.username,"NIKOS");
assert.equal(register.sent.at(-1).body.masterAdmin,"SECRET-FOR-TEST-ONLY");
assert.equal(register.el.accountMasterAdmin.value,"");
assert(!JSON.stringify(register.localStorage.getItem("carServiceActiveAccountV3")).includes("SECRET-FOR-TEST-ONLY"));

const changed=mount({username:"ANDREAS",scope,session});
for(let i=0;i<30;i++)await Promise.resolve();
assert.equal(changed.started.length,1,"Saved session should restore before password change");
changed.el.accountCurrentPassword.value="UI-TEST-PASSWORD";
changed.el.accountNewPassword.value="strong-new-password";
await changed.el.accountPasswordForm.fire("submit");
assert.equal(changed.state.reloaded,1);
assert.equal(JSON.parse(changed.localStorage.getItem("carServiceActiveAccountV3")).session,updatedSession);
assert.equal(changed.el.accountNewPassword.value,"");
console.log("PASS: remember-me and tab sessions, master signup, session restore, and password change");
