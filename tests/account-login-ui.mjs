/* Run: node tests/account-login-ui.mjs
 * The login screen is intentionally minimal; registration is a separate view.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const html=readFileSync(resolve(root,"public/index.html"),"utf8");
const storedJs=readFileSync(resolve(root,"public/account.js"),"utf8");
const embedded=html.match(/<script id="accountLoginRuntime">([\s\S]*?)<\/script>/);
assert(embedded,"Login must ship with its HTML to avoid stale PWA script versions");
const js=embedded[1].trim();
assert.equal(js,storedJs.trim(),"Embedded login runtime must match tested account.js");
const critical=html.match(/<style id="accountCriticalStyles">([\s\S]*?)<\/style>/);
assert(critical,"Critical login appearance must work even when /ui.css fails");
assert(critical[1].includes("body.account-locked main"),"Other pages must stay hidden at login");
assert(critical[1].includes(".account-options-trigger svg"),"Login SVG icon must be constrained");
assert(critical[1].includes("width:21px!important"),"SVG may not inflate on iPhone");
assert(!html.includes('<script src="/account.js"></script>'),"Do not load a duplicate cached login runtime");
const css=readFileSync(resolve(root,"public/ui.css"),"utf8");
assert(css.includes(".account-card [hidden]{display:none!important}"),
  "All hidden panels and controls must actually be invisible despite button CSS");
assert(html.includes('id="accountRegisterPanel" class="account-panel" hidden'));
assert(html.includes('id="accountOpenRegister"'));
assert(!html.includes('id="accountChooseCustom"'));
assert(html.includes('class="account-options-trigger"'),"Account options icon should be discreet");
assert(!html.includes('Δεν έχεις λογαριασμό;'),"Account creation not displayed by default");
assert(html.includes('id="accountLoginBtnText"'),"Loading text should be present");

class Element {
  constructor(id,hidden=false) {
    this.id=id;this.hidden=hidden;this.value="";this.textContent="";
    this.disabled=false;this.listeners={};this.attributes={};
    this.classList={toggle(){},remove(){}};
  }
  setAttribute(key,value){this.attributes[key]=String(value)}
  removeAttribute(key){delete this.attributes[key]}
  addEventListener(event,cb){(this.listeners[event]??=[]).push(cb)}
  async fire(event){for(const cb of this.listeners[event]||[])await cb({preventDefault(){}})}
  focus(){this.focused=true}
}
function mount() {
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const els=Object.fromEntries(ids.map(id=>{
    const tag=html.match(new RegExp('<[^>]+\\bid="'+id+'"[^>]*>'))?.[0]||"";
    return [id,new Element(id,/\shidden(?:\s|>|=)/.test(tag))];
  }));
  const map=new Map();
  const localStorage={
    getItem:key=>map.get(key)||null,
    setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key)
  };
  const scope="f".repeat(64);
  const session="ST-"+scope+"-"+"B".repeat(48);
  const requests=[],started=[];
  const fetch=async(path,options)=>{
    const body=JSON.parse(options.body||"{}");
    requests.push({path,body});
    if(path==="/api/account/create"){
      if(body.code==="1234"){
        return {ok:false,status:409,json:async()=>({error:"Ο κωδικός χρησιμοποιείται ήδη. Διάλεξε άλλον."})};
      }
      return {ok:true,status:200,json:async()=>({code:body.code||"5678",scope,session})};
    }
    if(path==="/api/account/login"){
      if(body.code==="WRONG")return {ok:false,status:401,json:async()=>({error:"Λάθος κωδικός"})};
      return {ok:true,status:200,json:async()=>({scope,session})};
    }
    if(path==="/api/account/session")return {ok:true,status:200,json:async()=>({scope})};
    throw new Error("Unexpected URL: "+path);
  };
  const document={getElementById:id=>els[id],body:{classList:{remove(){}}}};
  const window={CarAppStartAccount:(code,s)=>started.push({code,scope:s}),addEventListener(){}};
  const AbortControllerStub=class{
    constructor(){
      this.signal={aborted:false,addEventListener(){},removeEventListener(){}};
    }
    abort(){this.signal.aborted=true;}
  };
  new Function("document","window","localStorage","fetch","navigator","location",
    "crypto","TextEncoder","prompt","alert","confirm",
    "AbortController","setTimeout","clearTimeout",js)(
    document,window,localStorage,fetch,
    {onLine:true,clipboard:{writeText:async()=>{}}},
    {reload(){}},{subtle:{}},class{},()=>{},()=>{},()=>true,
    AbortControllerStub,()=>1,()=>{}
  );
  return {els,started,requests,localStorage,scope,session};
}

// Initial state: one code box and one login button, no registration options.
const app=mount();
const e=app.els;
assert.equal(e.accountLoginPanel.hidden,false);
assert.equal(e.accountRegisterPanel.hidden,true);
assert.equal(e.accountCreated.hidden,true);
await e.accountOpenRegister.fire("click");
assert.equal(e.accountLoginPanel.hidden,true);
assert.equal(e.accountRegisterPanel.hidden,false);
assert.equal(e.accountRegisterChoices.hidden,false);
assert.equal(e.accountOpenRegister.hidden,true);
await e.accountBackToLogin.fire("click");
assert.equal(e.accountOpenRegister.hidden,false);
assert.equal(e.accountLoginPanel.hidden,false);
assert.equal(e.accountRegisterPanel.hidden,true);

// Registration: rejected codes stay on the registration screen.
await e.accountOpenRegister.fire("click");
e.accountCustomCode.value="1234";
await e.accountCustomForm.fire("submit");
assert.match(e.accountMessage.textContent,/χρησιμοποιείται ήδη/);
assert.equal(e.accountRegisterChoices.hidden,false);
assert.equal(e.accountCreated.hidden,true);
e.accountCustomCode.value="12345678ςς";
await e.accountCustomForm.fire("submit");
assert.equal(app.requests.at(-1).body.code,"12345678ΣΣ");
assert.equal(e.accountNewCode.textContent,"12345678ΣΣ");
assert.equal(e.accountRegisterChoices.hidden,true);
assert.equal(e.accountCreated.hidden,false);
assert.equal(e.accountBackToLogin.hidden,true);
await e.accountContinue.fire("click");
assert.equal(e.accountGate.hidden,true);
assert.equal(app.started[0].code,app.session);
assert.equal(JSON.parse(app.localStorage.getItem("carServiceActiveAccountV3")).code,"12345678ΣΣ");

// Generated registration is available ONLY inside the separate registration view.
const random=mount();
await random.els.accountOpenRegister.fire("click");
await random.els.accountCreate.fire("click");
assert.equal(random.els.accountNewCode.textContent,"5678");
assert.equal(random.els.accountCreated.hidden,false);

// Existing-user login remains a single action.
const returning=mount();
returning.els.accountCode.value="WRONG";
await returning.els.accountLoginForm.fire("submit");
assert.equal(returning.els.accountLoginBtn.disabled,false);
assert.equal(returning.els.accountLoginBtnText.textContent,"Σύνδεση");
assert.match(returning.els.accountMessage.textContent,/Λάθος κωδικός/);
returning.els.accountCode.value="5678";
await returning.els.accountCode.fire("input");
await returning.els.accountLoginForm.fire("submit");
assert.equal(returning.started.length,1);
assert.equal(returning.started[0].code,returning.session);
assert.equal(returning.els.accountRegisterPanel.hidden,true);

console.log("PASS: self-contained login HTML/CSS/JS, small SVG, submit handling, registration and session login");
