/* Run: node tests/history-recovery.mjs
 * Pure regression coverage for lost-history safeguards and read-only recovery.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const html=readFileSync(resolve(root,"public/index.html"),"utf8");
const account=readFileSync(resolve(root,"public/account.js"),"utf8");
const worker=readFileSync(resolve(root,"src/index.js"),"utf8");
const start=html.indexOf("function accountIsCurrent(){");
const finish=html.indexOf("function copyLegacyLocal(){",start);
assert(start>0&&finish>start,"Session ownership check missing");
const code=html.slice(start,finish);
const scope="a".repeat(64),token="ST-"+scope+"-"+"A".repeat(48);
const key="carServiceActiveAccountV3";
function owns(localValue,sessionValue){
  const localStorage={getItem:k=>k===key?localValue:null};
  const sessionStorage={getItem:k=>k===key?sessionValue:null};
  return new Function("localStorage","sessionStorage","ACTIVE_SCOPE",
    "ACTIVE_TOKEN","ACCOUNT_SESSION_KEY",
    code+"\nreturn accountIsCurrent();")(
      localStorage,sessionStorage,scope,token,key);
}
const active=JSON.stringify({scope,session:token});
assert.equal(owns(null,active),true,"Remember-me OFF must still allow cloud sync");
assert.equal(owns(active,null),true,"Remember-me ON must still allow cloud sync");
assert.equal(owns(null,null),false,"No saved session should not sync");
assert.equal(owns(JSON.stringify({scope,session:"invalid"}),null),false);
assert.equal(owns(JSON.stringify({scope:"b".repeat(64),session:token}),null),false);

assert(html.includes("remote.items.length===0&&local.items.length>0&&"),
  "Unexpectedly empty cloud must not discard a previous local history");
assert(html.includes("Array.isArray(base?.items)&&base.items.length>0"));
assert(html.includes('id="accountRecoveryForm"'));
assert(html.includes('id="accountRecoveryMaster"'));
assert(html.includes('id="accountRecoveryStatus"'));
assert(account.includes('"/api/account/recovery-check"'));
assert(account.includes("masterField.value=\"\""),"Master must not be retained after inspecting");
assert(worker.includes('"/api/account/recovery-check" && req.method === "POST"'));
assert(worker.includes('if(!account)return jsonNoStore'),"Authentication is mandatory");
assert(worker.includes('identity.scope!==account.scope'),"Source check must be scoped to correct logged-in identity");
assert(worker.includes('sameOriginalAccount:account.scope===expectedScope'));
const part=worker.slice(worker.indexOf('if (url.pathname === "/api/account/recovery-check"'),
  worker.indexOf('if (url.pathname === "/api/account/migrate"'));
assert(!/\.fetch\([^)]*,\s*\{\s*method:\s*"(?:PUT|DELETE)"/.test(part),
  "Diagnostic must not issue mutating fetches");
assert(!part.includes('storage.put('),"Diagnostic must not write Durable Object storage");
assert(html.includes("Δεν αφορά τους προσωπικούς λογαριασμούς Andreas, Nick ή Vasdim"),
  "Common PASSCODE transfer must not mislead users with personal PINs");
console.log("PASS: remembered and temporary account sync, data-loss guard, master-only read-only recovery diagnostics");
