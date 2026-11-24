/* Run: node tests/documents-wallet.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const doc=read("public/documents.js");
const html=read("public/index.html");
const features=read("public/features.js");
const sw=read("public/sw.js");
assert.doesNotThrow(()=>new Function(doc),"Document wallet must be valid JavaScript");
for(const id of ["documentsPanel","documentsShortcut","documentForm","documentFile","documentsList",
  "documentKind","documentExpiry","documentTitle","costInsurance","costKteo","costTax","costEmissions"])
  assert(html.includes('id="'+id+'"'),"Missing field "+id);
for(const kind of ["insurance","kteo","license","registration","tax","emissions","roadside","receipt","other"])
  assert(html.includes('value="'+kind+'"'),"Missing document category "+kind);
assert(html.includes('value="expenses"'),"Vehicle expenses must be selectable in history");
assert(html.includes('data-filter="expenses"'),"Expenses filter must exist");
assert(html.includes('data-visible-kind="expenses"'),"Account visibility setting for expenses missing");
assert(features.includes('cost:"costInsurance"')&&features.includes('cost:"costKteo"'),
  "Obligation summary must support cost fields");
assert(features.includes('costKind=obligationKinds.find'),"Obligation cost changes must be saved");
assert(sw.includes('"/documents.js"'),"Document wallet must be cached offline");
assert(sw.includes('carhistory-shell-v19'),"PWA cache must invalidate");
assert(doc.includes('createIndex("byScope","scope"'),"Documents must be separated by account");
assert(doc.includes('blob:file'),"File contents must be written to IndexedDB");
assert(doc.includes("URL.createObjectURL(doc.blob)"),"Local document viewing must be available");
assert(doc.includes('URL.revokeObjectURL(url)'),"Object URL cleanup missing");
assert(doc.includes('id="documentFile"')===false,"Wallet should use DOM and never inline document content");
assert(!doc.includes("fetch("),"Sensitive document bytes must not be sent to the server");
assert(!doc.includes("XMLHttpRequest"),"No document uploads to a remote endpoint");
console.log("PASS: vehicle costs, document types, local-only wallet, account isolation and offline shell");
