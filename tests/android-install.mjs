/* Run: node tests/android-install.mjs
 * PWA installation button must be visible on non-installed Android only.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const base=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const html=readFileSync(resolve(base,"public/index.html"),"utf8");
const css=readFileSync(resolve(base,"public/ui.css"),"utf8");
const sw=readFileSync(resolve(base,"public/sw.js"),"utf8");
const features=readFileSync(resolve(base,"public/features.js"),"utf8");
const script=html.match(/<script id="androidInstallRuntime">([\s\S]*?)<\/script>/)?.[1];
assert(script,"Install runtime must exist BEFORE username/password login");
assert(html.indexOf('id="androidInstallRuntime"')<html.indexOf('id="accountLoginRuntime"'));
assert(html.includes('id="accountInstallBtn"'),"Login install button missing");
assert(html.includes('id="installBtn"'),"Home install button missing");
assert(!features.includes("function setupInstall()"),"Do not attach a second installer after login");
assert(css.includes(".install-trigger[hidden]"));
assert(sw.includes('carhistory-shell-v31'));
assert.doesNotThrow(()=>new Function(script));

function mount({ua="Mozilla/5.0 (Linux; Android 14) Chrome/131",
  standalone=false,installed=false}={}){
  const listeners=new Map(),elements=new Map(),store=new Map();
  if(installed)store.set("carhistory-pwa-installed-v1","1");
  const get=id=>{
    if(!elements.has(id)){
      const node={
        id,hidden:true,open:false,textContent:"",
        callbacks:{},addEventListener(name,fn){this.callbacks[name]=fn;},
        showModal(){this.open=true;},close(){this.open=false;}
      };
      elements.set(id,node);
    }
    return elements.get(id);
  };
  const media={matches:standalone,listeners:[],
    addEventListener(_,fn){this.listeners.push(fn);}};
  const window={
    matchMedia(query){
      return query==="(display-mode: standalone)"?media:{matches:false};
    },
    addEventListener(type,fn){
      const all=listeners.get(type)||[];
      all.push(fn);
      listeners.set(type,all);
    }
  };
  const navigator={
    userAgent:ua,standalone:false,
    serviceWorker:{register:async()=>({})}
  };
  const document={getElementById:get};
  const localStorage={
    getItem:k=>store.get(k)||null,
    setItem:(k,v)=>store.set(k,v),
    removeItem:k=>store.delete(k)
  };
  const location={protocol:"https:",hostname:"example.com"};
  new Function("window","navigator","document","localStorage","location",
    "console",script)(window,navigator,document,localStorage,location,console);
  return {
    get,store,media,
    dispatch(type,value={}){for(const listener of listeners.get(type)||[])listener(value);}
  };
}
const browser=mount();
assert.equal(browser.get("accountInstallBtn").hidden,false);
assert.equal(browser.get("installBtn").hidden,false);
assert.equal(browser.get("installHelp").open,false);
let prompted=0;
browser.dispatch("beforeinstallprompt",{
  preventDefault(){this.prevented=true;},
  async prompt(){prompted++;},
  userChoice:Promise.resolve({outcome:"accepted"})
});
await browser.get("accountInstallBtn").callbacks.click();
assert.equal(prompted,1,"Android should call native PWA install prompt");
assert.equal(browser.get("accountInstallBtn").hidden,true);
assert.equal(browser.get("installBtn").hidden,true);
assert.equal(browser.store.get("carhistory-pwa-installed-v1"),"1");

const installed=mount({installed:true});
assert.equal(installed.get("accountInstallBtn").hidden,true);
assert.equal(installed.get("installBtn").hidden,true);
const webApp=mount({standalone:true});
assert.equal(webApp.get("accountInstallBtn").hidden,true);
assert.equal(webApp.get("installBtn").hidden,true);
const iphone=mount({ua:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari"});
assert.equal(iphone.get("accountInstallBtn").hidden,true);
assert.equal(iphone.get("installBtn").hidden,true);
const manual=mount();
await manual.get("installBtn").callbacks.click();
assert.equal(manual.get("installHelp").open,true);
assert.match(manual.get("installHelpText").textContent,/Chrome/);
manual.get("installDismiss").callbacks.click();
assert.equal(manual.get("installHelp").open,false);
const dismissed=mount();
dismissed.dispatch("beforeinstallprompt",{
  preventDefault(){},async prompt(){},
  userChoice:Promise.resolve({outcome:"dismissed"})
});
await dismissed.get("installBtn").callbacks.click();
assert.equal(dismissed.get("installBtn").hidden,false,
  "Dismissed installation should remain available");
const afterInstall=mount();
afterInstall.dispatch("appinstalled");
assert.equal(afterInstall.get("installBtn").hidden,true);
assert.equal(afterInstall.store.get("carhistory-pwa-installed-v1"),"1");
const returned=mount({installed:true});
returned.dispatch("beforeinstallprompt",{preventDefault(){},async prompt(){},
  userChoice:Promise.resolve({outcome:"dismissed"})});
assert.equal(returned.get("installBtn").hidden,false,
  "If the user uninstalls later, a new browser prompt must restore the button");
console.log("PASS: Android install button on login and home, native prompt, manual fallback, installed/standalone hidden, iPhone hidden, uninstall re-offer");
