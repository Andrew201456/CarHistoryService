/* Run: node tests/ui-aurora.mjs
 * Visual-only release guard: no changes to login, auth or persistence.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const css=readFileSync(resolve(root,"public/ui.css"),"utf8");
const html=readFileSync(resolve(root,"public/index.html"),"utf8");
const sw=readFileSync(resolve(root,"public/sw.js"),"utf8");
const auth=readFileSync(resolve(root,"public/account.js"),"utf8");
const worker=readFileSync(resolve(root,"src/index.js"),"utf8");

assert(css.includes("AURORA v31"));
assert(css.includes("body:not(.account-locked)"),
  "Style must not override the standalone login screen");
for(const selector of [
  ".home-vehicle-heading h1",".next",".overview-card",".due-chip",
  ".item",".filters button.selected",".documents-shortcut",
  "nav button.on",".account-section",".ai-composer"
]){
  assert(css.includes(selector),"Missing premium surface "+selector);
}
assert(css.includes("prefers-color-scheme:dark"));
assert(css.includes(':root[data-theme="dark"]'));
assert(css.includes("prefers-reduced-motion:reduce"));
assert(css.includes("safe-area-inset-bottom"),"Floating dock needs iPhone/Android safe-area");
assert(css.includes("color-mix"),"Tints should adapt to the user's theme");
assert(sw.includes("carhistory-shell-v31"),"Installed PWA must refresh cached styles");
assert(html.includes('id="homeVehicleName"'));
assert(html.includes('id="accountRecoveryForm"'));
assert(html.includes('id="accountRememberMe"'));
assert(html.includes('id="documentsPanel"'));
assert(html.includes('id="accountInstallBtn"'));
assert(html.includes('id="installBtn"'));
const embedded=html.match(/<script id="accountLoginRuntime">([\s\S]*?)<\/script>/);
assert.equal(embedded?.[1].trim(),auth.trim(),"Login logic must not diverge");
assert(worker.includes('/api/account/recovery-check'),
  "Nick history recovery route must be preserved");
assert(worker.includes("LEGACY_USER_SCOPES"),
  "Original account mappings must be preserved");

// Check balanced braces, ignoring the small risk of CSS strings containing braces.
let depth=0;
for(const ch of css){
  if(ch==="{")depth++;
  if(ch==="}")depth--;
  assert(depth>=0,"Unexpected CSS closing brace");
}
assert.equal(depth,0,"CSS block syntax is unbalanced");
console.log("PASS: Aurora v31 visually refines UI, preserves login, Nick recovery, Android install, and PWA update");
