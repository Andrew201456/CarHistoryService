/* Run: node tests/home-vehicle-title.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const html=readFileSync(resolve(root,"public/index.html"),"utf8");
const ai=readFileSync(resolve(root,"public/ai-mechanic.js"),"utf8");
const css=readFileSync(resolve(root,"public/ui.css"),"utf8");
assert(html.includes('id="homeVehicleName"'),"Home heading element missing");
const start=html.indexOf("function updateHomeVehicleTitle(){");
const end=html.indexOf("function render(){",start);
assert(start>0&&end>start,"Home title should update with every history render");
const snippet=html.slice(start,end);
assert(snippet.includes("settings.vehicleProfile"));
assert(snippet.includes('heading.textContent=title||"Καταχώρησε αυτοκίνητο"'));
assert(html.slice(end,end+120).includes("updateHomeVehicleTitle();"),
  "Render should refresh after data sync");
assert(ai.includes("window.CarHistoryUpdateHomeTitle?.();"),
  "Edits to registered car must update the home title immediately");
assert(css.includes(".home-vehicle-heading h1"),"Long vehicle names must wrap");
const heading={textContent:""};
const element=id=>id==="homeVehicleName"?heading:null;
const window={};
const settings={vehicleProfile:{make:"Ford",model:"Focus",year:"2007"}};
const update=new Function("settings","window","$",
  snippet+"\nreturn updateHomeVehicleTitle;")(settings,window,element);
update();
assert.equal(heading.textContent,"Ford Focus 2007");
settings.vehicleProfile={make:"BMW",model:"320d",year:""};
window.CarHistoryUpdateHomeTitle();
assert.equal(heading.textContent,"BMW 320d");
settings.vehicleProfile={};
update();
assert.equal(heading.textContent,"Καταχώρησε αυτοκίνητο");
console.log("PASS: registered car title, cross-device synced profile, immediate edits and safe empty fallback");
