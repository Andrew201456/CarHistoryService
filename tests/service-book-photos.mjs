/* Run: node tests/service-book-photos.mjs
 * Photo importer: authenticated multimodal OCR, validation, editable preview.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const html=read("public/index.html");
const worker=read("src/index.js");
const css=read("public/ui.css");

for(const id of ["impPhotos","impPhotoList","impTxt","impGo","impList","impAdd"])
  assert(html.includes('id="'+id+'"'),"Missing importer element "+id);
assert(html.includes('type="file" id="impPhotos"'));
assert(html.includes("multiple class=\"import-photo-native\""));
assert(html.includes("MAX_IMPORT_PHOTOS=8"));
assert(html.includes("photoToDataUrl(file)"));
assert(html.includes('canvas.toDataURL("image/jpeg"'));
assert(html.includes('fetch("/api/parse-image"'));
assert(html.includes('fetch("/api/parse"'));
assert(html.includes("Ανάλυση με AI"));
assert(html.includes("Προσθήκη επιλεγμένων"));
assert(html.includes('if(isDup(e)||(key&&seen.has(key)))e.on=false'));
assert(html.includes('if(key&&seen.has(key))duplicates.push(e)'),
  "Duplicates must be checked again immediately before saving");
assert(css.includes(".import-photo-picker"));
assert(css.includes(".import-photo-item"));
assert(css.includes(".import-photo-list"));

const start=worker.indexOf('if (url.pathname === "/api/parse-image"');
const end=worker.indexOf('if (url.pathname === "/api/parse" && req.method',start);
assert(start>0&&end>start,"Photo endpoint missing or wrongly ordered");
const body=worker.slice(start,end);
assert(!body.includes("storage.put"),"Photo OCR must not store uploaded photos");
assert(!body.includes("CAR_MASTER_ADMIN"),"Photo OCR must use normal session");
const execute=new Function("url","req","env","getAccount","jsonNoStore",
  "console",`return (async()=>{ ${body} return null; })();`);
const dataUrl="data:image/jpeg;base64,"+"A".repeat(800);
function request(payload){
  return {method:"POST",headers:{get(name){return null}},json:async()=>payload};
}
function response(data,status=200){
  return {status,ok:status>=200&&status<300,
    async json(){return data}};
}
async function invoke(payload,{authorized=true,visionText="14/04/2022, 129.000 χλμ., αλλαγή λαδιών",
   failAI=false}={}){
  const calls=[];
  const env={AI:{async run(model,args){
    calls.push({model,args});
    if(failAI)throw Error("model unavailable");
    return {response:visionText}
  }}};
  const output=await execute({pathname:"/api/parse-image"},request(payload),
    env,async()=>authorized?{scope:"test"}:null,
    (obj,status=200)=>response(obj,status),{error(){}});
  return {output,calls,body:await output.json()};
}
let run=await invoke({image:dataUrl});
assert.equal(run.output.status,200);
assert.equal(run.body.text,"14/04/2022, 129.000 χλμ., αλλαγή λαδιών");
assert.equal(run.calls.length,1);
assert.equal(run.calls[0].model,"@cf/meta/llama-3.2-11b-vision-instruct");
assert.equal(run.calls[0].args.image,dataUrl);
assert(run.calls[0].args.messages[0].content.includes("ΜΗΝ μαντεύεις"));

run=await invoke({image:dataUrl},{authorized:false});
assert.equal(run.output.status,401);
assert.equal(run.calls.length,0,"Unauthenticated requests must not call paid AI");

for(const invalid of [
  null,"hello","https://untrusted.example/photo.jpg",
  "data:text/html;base64,"+"A".repeat(800),
  "data:image/gif;base64,"+"A".repeat(800),
  "data:image/jpeg;base64,"+"A".repeat(3_100_001)
]){
  run=await invoke({image:invalid});
  assert.equal(run.output.status,400);
  assert.equal(run.calls.length,0);
}
run=await invoke({image:dataUrl},{visionText:""});
assert.equal(run.output.status,422,"Unreadable image must not create fabricated entries");
run=await invoke({image:dataUrl},{failAI:true});
assert.equal(run.output.status,502,"Cloudflare vision failure should be actionable");

console.log("PASS: photo picker + compression, authenticated image OCR, no persistence, editable previews, duplicate checks and model errors");
