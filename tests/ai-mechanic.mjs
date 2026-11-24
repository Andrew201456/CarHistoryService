/* Run with: node tests/ai-mechanic.mjs */
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const moduleCode=read("src/diagnostics.js");
const {buildDiagnosticMessages,handleDiagnosticRequest,DIAGNOSTIC_MODEL} =
  await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(moduleCode));

const history=[
  {date:"2025-01-12",km:"140.000",regular:true,parts:[{name:"Αλλαγή λαδιών",cost:"55"}],notes:"",where:"private-name"},
  {date:"2026-06-14",km:"151000",regular:false,parts:[{name:"Δίσκοι φρένων"}],notes:"Αλλαγή δίσκων"},
  {date:"2026-11-05",km:"158000",regular:true,parts:[{name:"Αλλαγή μπουζί"}],notes:""},
];
const payload={
  question:"Τρέμει όταν φρενάρω. Έχουν αλλαχτεί οι δίσκοι;",
  vehicle:"Ford Focus 1.6 2007",currentKm:"160000",serviceIntervalKm:"10000",
  history,reminders:[{name:"Αλλαγή φίλτρου",dueKm:"162000",repeatKm:"10000"}],
  conversation:[{role:"user",content:"Έχω έναν θόρυβο"},{role:"assistant",content:"Πες πότε τον ακούς"}]
};
const modernProfile={
  make:"Ford",model:"Focus",year:"2007",fuel:"Βενζίνη",engine:"1.6 Ti-VCT",
  cc:"1596",power:"115",gearbox:"Χειροκίνητο",trim:"Ghia",
  notes:"Χωρίς μετατροπές",secret:"this must not be passed"
};
const modern=buildDiagnosticMessages({...payload,vehicle:modernProfile});
const modernContext=JSON.parse(modern.messages[1].content.slice(modern.messages[1].content.indexOf("{")));
assert.equal(modernContext.car.make,"Ford");
assert.equal(modernContext.car.model,"Focus");
assert.equal(modernContext.car.year,"2007");
assert.equal(modernContext.car.engine,"1.6 Ti-VCT");
assert.equal(modernContext.car.cc,"1596");
assert.equal(modernContext.car.power,"115");
assert.equal(modernContext.car.fuel,"Βενζίνη");
assert.equal(modernContext.car.gearbox,"Χειροκίνητο");
assert.ok(!JSON.stringify(modernContext).includes("secret"),"Unrecognized profile fields must be stripped");
const invalidProfile=buildDiagnosticMessages({...payload,vehicle:{year:"3000",cc:"-5",make:"Focus"}});
const invalidContext=JSON.parse(invalidProfile.messages[1].content.slice(invalidProfile.messages[1].content.indexOf("{")));
assert.equal(invalidContext.car.year,undefined);
assert.equal(invalidContext.car.cc,undefined);
assert.equal(invalidContext.car.make,"Focus");
const prepared=buildDiagnosticMessages(payload);
assert.equal(prepared.usedEntries,3);
assert.equal(prepared.messages.at(-1).role,"user");
assert.equal(prepared.messages.at(-1).content,payload.question);
assert.equal(prepared.messages.length,5);
const context=JSON.parse(prepared.messages[1].content.slice(prepared.messages[1].content.indexOf("{")));
assert.equal(context.car,payload.vehicle);
assert.equal(context.currentOdometerKm,160000);
assert.equal(context.scheduledServiceIntervalKm,10000);
assert.equal(context.history.length,3);
assert.equal(context.history[0].date,"2026-11-05");
assert.equal(context.history[1].type,"επισκευή");
assert.equal(context.history[1].works[0],"Δίσκοι φρένων");
assert.equal(context.history[2].km,140000);

const modifications=buildDiagnosticMessages({...payload,history:[
  {date:"2026-11-18",km:"159000",regular:false,kind:"improvements",
    parts:[{name:"Stage 1 / ECU remap",cost:"250"}],notes:"βελτίωση χαρτογράφησης"},
  {date:"2026-09-18",km:"154000",regular:false,kind:"tires",
    parts:[{name:"Ελαστικά",cost:"400"}],notes:"νέα ελαστικά"},
]});
const modificationsContext=JSON.parse(modifications.messages[1].content.slice(
  modifications.messages[1].content.indexOf("{")));
assert.equal(modificationsContext.history[0].type,"βελτίωση",
  "AI must not confuse upgrades with repairs");
assert.equal(modificationsContext.history[1].type,"ελαστικά",
  "AI must recognize tire changes");
assert.equal(modificationsContext.history[0].works[0],"Stage 1 / ECU remap");

assert.ok(!JSON.stringify(context).includes("private-name"),"Unneeded workshop names must not be forwarded");
assert.match(prepared.messages[0].content,/φρένων/);
assert.match(prepared.messages[0].content,/μην.*επινοείς/i);
assert.throws(()=>buildDiagnosticMessages({...payload,question:"x"}));
assert.throws(()=>buildDiagnosticMessages({...payload,history:new Array(126).fill(history[0])}));
assert.throws(()=>buildDiagnosticMessages({...payload,conversation:new Array(13).fill({role:"user",content:"Hi"})}));
assert.throws(()=>buildDiagnosticMessages({...payload,question:"a".repeat(1801)}));

let called;
const env={
  AI:{async run(model,options){
    called={model,options};
    return {response:"Πιθανή αιτία: έλεγχος δίσκων και τακακιών από συνεργείο."};
  }}
};
const mkReq=body=>new Request("https://service.example/api/diagnose",{
 method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
});
const response=await handleDiagnosticRequest(mkReq(payload),env);
assert.equal(response.status,200);
assert.equal(response.headers.get("Cache-Control"),"no-store");
const result=await response.json();
assert.equal(result.usedEntries,3);
assert.match(result.answer,/έλεγχος δίσκων/);
assert.equal(called.model,DIAGNOSTIC_MODEL);
assert.equal(called.options.messages[0].role,"system");
assert.equal(called.options.messages.at(-1).content,payload.question);
assert.ok(called.options.max_tokens<=2000);
assert.equal((await handleDiagnosticRequest(mkReq({...payload,question:"x"}),env)).status,400);
assert.equal((await handleDiagnosticRequest(mkReq(payload),{})).status,503);
const huge=new Request("https://service.example/api/diagnose",{method:"POST",body:"x".repeat(130001)});
assert.equal((await handleDiagnosticRequest(huge,env)).status,413);

const worker=read("src/index.js");
assert(worker.includes('import {handleDiagnosticRequest} from "./diagnostics.js"'));
assert(worker.includes('url.pathname === "/api/diagnose"'));
const aiStart=worker.indexOf('if (url.pathname === "/api/diagnose")');
const aiEnd=worker.indexOf('if (url.pathname === "/api/parse"',aiStart);
const route=worker.slice(aiStart,aiEnd);
assert(route.includes('if (!(await getAccount(req, env)))'),"AI route must validate the caller's own account");
assert(route.includes('req.method !== "POST"'),"AI route must only accept POST");
assert(route.includes('return handleDiagnosticRequest(req, env)'));
const config=read("wrangler.jsonc");
assert.match(config,/"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/);
const html=read("public/index.html"),script=read("public/ai-mechanic.js"),css=read("public/ui.css"),sw=read("public/sw.js");
assert.equal([...html.matchAll(/data-v="(?:list|form|import|ai|backup)"/g)].length,5);
assert(html.includes('id="v-ai"'));
for(const id of ["aiQuestion","aiMessages","aiForm","aiClear","aiProfileOpen","aiVehicleDialog",
 "aiVehicleForm","aiSaveVehicle","aiVehicleSummary","aiVehicleSubtitle","aiHistoryCount",
 "aiCarMake","aiCarModel","aiCarYear","aiCarFuel","aiCarEngine","aiCarCc",
 "aiCarPower","aiCarGearbox","aiCarTrim","aiCarNotes"]){
 assert(html.includes('id="'+id+'"'),"AI UI element missing: "+id);
}
assert.doesNotThrow(()=>new Function(script));
assert(script.includes('content.textContent=msg.content'),"AI response must be rendered as text, not HTML");
assert(script.includes('fetch("/api/diagnose"'));
assert(script.includes('headers:{"Authorization":"Bearer "+pass,"Content-Type":"application/json"}'));
assert(script.includes("settings.vehicleProfile=values;"),"The structured profile must be persisted");
assert(script.includes("store(); // existing local storage + authenticated cross-device sync"),"The profile must use the existing sync");
assert(script.includes("vehicle:getProfile()"),"The AI request must include the saved vehicle profile");
assert(script.includes("kind:itemKind(it)"),"AI history must carry service categories");
assert(script.includes("profileDialog.showModal()"),"Car profile editor should open as a dialog");
assert(!html.includes('id="aiVehiclePanel"'),"Old accordion UI should be gone");
assert(html.includes('class="ai-composer"'),"Composer should use redesigned chat UI");
assert(css.includes(".ai-profile-dialog"),"Vehicle profile needs its own styling");
assert(css.includes(".ai-conversation"),"Conversation styling should exist");
assert(css.includes(".ai-conversation"));
assert(css.includes(".ai-profile-dialog"));
assert(sw.includes('carhistory-shell-v24'));
assert(sw.includes('"/ai-mechanic.js"'));
assert(!worker.includes("OpenAI_API_KEY"),"AI must use existing binding, not exposed API keys");
console.log("PASS: structured car profile, legacy car field, diagnostic context, authenticated chat and redesigned UI");
