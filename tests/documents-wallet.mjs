/* Run: node tests/documents-wallet.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const load=path=>readFileSync(resolve(root,path),"utf8");
const html=load("public/index.html");
const ui=load("public/documents.js");
const worker=load("src/index.js");
const features=load("public/features.js");
const sw=load("public/sw.js");
assert.doesNotThrow(()=>new Function(ui));
assert.doesNotThrow(()=>new Function(features));
assert.doesNotThrow(()=>new Function(sw));
for(const id of ["documentsShortcut","documentsPanel","documentForm","documentsList",
  "documentPreview","documentPreviewFrame","documentPreviewImage",
  "documentPreviewDownload","documentPreviewNewTab","documentCost","documentExpiry",
  "documentFile","documentsCount"]){
  assert(html.includes('id="'+id+'"'),"Missing UI element "+id);
}
for(const [kind,field] of [["insurance","costInsurance"],["kteo","costKteo"],
  ["tax","costTax"],["emissions","costEmissions"]]){
  assert(html.includes('id="'+field+'"'));
  assert(html.includes('data-obligation-document="'+kind+'"'));
  assert(features.includes('key:"'+kind+'"'));
}
assert(features.includes('data-document-kind'),"Dashboard cards must open linked documents");
assert(features.includes('window.CarHistoryObligations'),"Document dates and costs must sync to obligations");
assert(ui.includes('"/api/documents"'),"Document metadata must be loaded from Cloudflare");
assert(ui.includes('"/api/documents/"+result.id+"/chunk/"+n'),"Upload must use authenticated chunks");
assert(ui.includes('"/api/documents/"+result.id+"/complete'),"Server must confirm the completed upload");
assert(ui.includes('Authorization":"Bearer "+token()'),"Cloud access must use account session");
assert(ui.includes('migrateOldDocs'),"Previous local-only files must be migrated");
assert(ui.includes('allLocal(owner)'),"Offline local cache required");
assert(ui.includes('cloudReady'),"Offline and remote states must be distinct");
assert(ui.includes('cache:"no-store"'),"Private content must never be cached by HTTP");
assert(ui.includes('Μόνο στη συσκευή · εκκρεμεί'),"Pending sync must be clearly indicated");
assert(worker.includes('handlePrivateDocuments(request,this.state)'),
  "Durable Object must implement account-private document storage");
assert(worker.includes('const account=await getAccount(req,env);'),
  "Private API must check the authenticated account");
assert(worker.includes('DOCUMENT_CHUNK=384*1024'));
assert(worker.includes('DOCUMENT_ACCOUNT_LIMIT=100*1024*1024'));
assert(sw.includes('carhistory-shell-v27'));
assert(sw.includes('"/documents.js"'));
assert(sw.includes('url.pathname.startsWith("/api/")'),"Service worker must not cache private endpoints");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(ids.length,new Set(ids).size);
console.log("PASS: linked obligations, authenticated cloud files, local migration, PWA and secure metadata");
