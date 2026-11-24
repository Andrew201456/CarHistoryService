/* Run: node tests/cloud-documents.mjs (Node 20+)
 * Test actual Cloudflare Durable Object document handler without deployment.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {webcrypto} from "node:crypto";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=readFileSync(resolve(root,"src/index.js"),"utf8");
const helper=source.slice(source.indexOf("const DOCUMENT_CHUNK="),source.indexOf("function tokenFrom(req)"));
assert(helper.startsWith("const DOCUMENT_CHUNK="),"Missing cloud-document handler");
const handler=new Function("Response","URL","ReadableStream","crypto",
  helper+"\nreturn {handlePrivateDocuments,DOCUMENT_CHUNK};")(
  Response,URL,ReadableStream,webcrypto
);
const chunk=handler.DOCUMENT_CHUNK;
function mockState(){
  const stored=new Map();
  return {storage:{
    get:async key=>stored.get(key),
    put:async (key,value)=>{stored.set(key,value);},
    delete:async key=>{stored.delete(key);},
    list:async({prefix})=>new Map([...stored].filter(([key])=>key.startsWith(prefix)))
  }};
}
async function call(state,path,method="GET",body=null){
  const request=new Request("https://internal.test"+path,{
    method,
    ...(body===null?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)}),
    ...(body!==null&&!(body instanceof Uint8Array)?{headers:{"Content-Type":"application/json"}}:{})
  });
  return handler.handlePrivateDocuments(request,state);
}
const account=mockState();
const second=mockState();
const size=chunk+211;
const input={
  clientKey:"migration-1234abcde",
  kind:"insurance",mime:"application/pdf",fileName:"policy.pdf",
  title:"Ασφαλιστήριο 2027",expiry:"2027-06-15",cost:320,size
};
const init=await call(account,"/docs","POST",input);
assert.equal(init.status,201);
const {id,chunkSize}=await init.json();
assert.equal(chunkSize,chunk);
const bytes=new Uint8Array(size);
for(let i=0;i<size;i++)bytes[i]=i%241;
assert.equal((await call(account,"/docs/"+id+"/chunk/0","PUT",bytes.subarray(0,chunk))).status,200);
assert.equal((await call(account,"/docs/"+id+"/complete","POST")).status,409,
  "Partial uploads must never be visible or marked complete");
assert.equal((await call(account,"/docs/"+id+"/chunk/1","PUT",bytes.subarray(chunk))).status,200);
assert.equal((await call(account,"/docs/"+id+"/complete","POST")).status,200);
const listed=await (await call(account,"/docs")).json();
assert.equal(listed.documents.length,1);
assert.equal(listed.documents[0].kind,"insurance");
assert.equal(listed.documents[0].expiry,"2027-06-15");
assert.equal(listed.documents[0].cost,320);
const file=await call(account,"/docs/"+id);
assert.equal(file.status,200);
assert.equal(file.headers.get("Cache-Control"),"private, no-store");
assert.equal(file.headers.get("X-Content-Type-Options"),"nosniff");
assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
const retried=await (await call(account,"/docs","POST",input)).json();
assert.equal(retried.id,id,"Retrying the same file must not duplicate it");
assert.equal(retried.status,"ready");
assert.equal((await call(second,"/docs/"+id)).status,404,
  "A distinct Durable Object cannot read the first account's files");
assert.equal((await call(account,"/docs","POST",{...input,clientKey:"html-12345678",mime:"text/html"})).status,400,
  "Executable HTML must never be accepted as document");
assert.equal((await call(account,"/docs","POST",{...input,clientKey:"overflow-12345678",size:25*1024*1024+1})).status,400,
  "File limit must be enforced on server");
assert.equal((await call(account,"/docs/"+id,"DELETE")).status,200);
assert.equal((await call(account,"/docs")).status,200);
assert.equal((await (await call(account,"/docs")).json()).documents.length,0);
console.log("PASS: private Durable Object upload, chunk validation, download, isolation, retry, quota and delete");
