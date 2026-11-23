/* Run with Node 20+: node tests/vehicle-deadlines.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const html=readFileSync(resolve(root,"public/index.html"),"utf8");
const features=readFileSync(resolve(root,"public/features.js"),"utf8");
const css=readFileSync(resolve(root,"public/ui.css"),"utf8");
const serviceKind=it=>it.kind==="tires"?"tires":it.regular===false?"repair":"regular";
const intOf=value=>parseInt(String(value??"").replace(/\D/g,""),10)||0;
const fmtKm=km=>Number(km).toLocaleString("el-GR")+" χλμ";
const esc=x=>String(x).replaceAll("&","&amp;").replaceAll("<","&lt;");
const isoOffset=days=>{
  const t=new Date();
  t.setHours(12,0,0,0);
  t.setDate(t.getDate()+days);
  return [t.getFullYear(),String(t.getMonth()+1).padStart(2,"0"),String(t.getDate()).padStart(2,"0")].join("-");
};
for(const field of ["dueInsurance","dueKteo","dueTax","dueEmissions"]){
  assert(html.includes('id="'+field+'" type="date"'),"Missing "+field);
}
assert(html.includes('data-filter="tires"'),"A separate tire filter is required");
assert(html.includes('id="serviceKind"'),"Entry kind must be selectable");
assert(html.includes('value="tires"'),"Tire entry option is missing");
assert(html.includes('id="tireLifeKm" type="number"'),"Tire lifetime must be numeric");
assert(html.includes('id="tireName"'),"Tire manufacturer/model field is missing");
assert(html.includes('kind,...(kind==="tires"?{tireName:'));
assert(html.includes('const reg=items.filter(i=>itemKind(i)==="regular"'),
  "Tire change must not affect next regular service");
assert(features.includes('tireLifeKm:$("tireLifeKm").value'),
  "Unsaved tire draft must preserve lifetime km");
assert(css.includes(".due-cards")&&css.includes(".tire-fields"));

class Element {
  constructor(id){
    this.id=id;this.listeners={};this.innerHTML="";this.textContent="";
    this.value="";this.hidden=false;this.open=false;this.dataset={};
    this.classList={toggle(){}};
  }
  addEventListener(name,handler){this.listeners[name]=handler}
  scrollIntoView(){this.scrolled=true}
  focus(){}
}
const elements=new Map();
const get=id=>{
  if(id==="installBtn"||id==="installHelp")return null;
  if(!elements.has(id))elements.set(id,new Element(id));
  return elements.get(id);
};
const document={
  getElementById:get,
  querySelector:selector=>get(selector),
  querySelectorAll:()=>[]
};
const settings={
  current:"55000",interval:10000,
  dueInsurance:isoOffset(7),dueKteo:isoOffset(100),
  dueTax:"",dueEmissions:isoOffset(-2)
};
const items=[
  {id:"T",kind:"tires",regular:false,date:isoOffset(-90),km:"20000",
   tireName:"Michelin",tireLifeKm:40000,parts:[{name:"Ελαστικά",cost:"450"}],labor:""}
];
const reminders=[];
let savedCount=0;
const window={
  CarHistoryAccountReady:true,
  CarHistoryAccountScope:"a".repeat(64),
  addEventListener(){}
};
const amount=it=>(it.parts||[]).reduce((sum,p)=>sum+Number(p.cost||0),0);
new Function(
  "window","document","settings","items","reminders","render","resetForm","store",
  "esc","fmtKm","estimateNextServiceDate","itemKind","intOf","num","money","total",
  "localStorage","navigator","location","matchMedia","confirm","alert","console",
  features
)(
  window,document,settings,items,reminders,()=>{},()=>{},()=>savedCount++,
  esc,fmtKm,()=>null,serviceKind,intOf,x=>Number(x)||0,x=>x+" €",amount,
  {getItem:()=>null,removeItem(){}},{},{},()=>({matches:false}),()=>true,()=>{},console
);
let summary=get("dueSummary").innerHTML;
assert.match(summary,/Ασφάλεια/);
assert.match(summary,/ΚΤΕΟ/);
assert.match(summary,/Κάρτα καυσαερίων/);
assert.match(summary,/Έληξε πριν 2 ημέρες/);
assert.match(summary,/Σε 7 ημέρες/);
assert.match(summary,/60\.000 χλμ/);
assert.match(summary,/Απομένουν 5\.000 χλμ/);

// Date edits use the same per-account settings that are synced and backed up.
get("dueTax").value=isoOffset(30);
get("obligationsPanel").listeners.change({target:get("dueTax")});
assert.equal(settings.dueTax,isoOffset(30));
assert.equal(savedCount,1);
assert.match(get("dueSummary").innerHTML,/Τέλη/);

// The small dashboard shortcut should reveal the calendar editor.
get("dueSummary").listeners.click({
  target:{closest:query=>query==="[data-due-settings]"?{}:null}
});
assert.equal(get("obligationsPanel").open,true);
assert.equal(get("obligationsPanel").scrolled,true);

// Changes in the odometer update the tire estimate without editing the tire record.
settings.current="58000";
window.renderExtras();
summary=get("dueSummary").innerHTML;
assert.match(summary,/Απομένουν 2\.000 χλμ/);
settings.current="64000";
window.renderExtras();
summary=get("dueSummary").innerHTML;
assert.match(summary,/Έχουν ξεπεραστεί κατά 4\.000 χλμ/);

// Old service vs repair vs new tire records remain separate.
const listSource=html.slice(html.indexOf("function haystack(it){"),html.indexOf("/* Φόρμα */"));
const records=[
  {id:"S",regular:true,date:isoOffset(-200),km:"30000",parts:[{name:"Λάδια",cost:"60"}]},
  {id:"R",regular:false,date:isoOffset(-100),km:"40000",parts:[{name:"Φρένα",cost:"100"}]},
  ...items
];
const list=get("list");
for(const [filter,shown] of [
  ["regular",["S"]],["repair",["R"]],["tires",["T"]]
]){
  const render=new Function(
    "items","historyFilter","$","norm","fmtDate","fmtKm","money","intOf",
    "total","num","hl","esc","settings","renderNext","itemKind",
    listSource+"return render;"
  )(
    records,filter,get,x=>String(x).toLowerCase(),x=>x||"",fmtKm,
    x=>x+" €",intOf,amount,x=>Number(x)||0,esc,esc,settings,()=>{},serviceKind
  );
  render();
  for(const id of ["S","R","T"]){
    assert.equal(list.innerHTML.includes('data-e="'+id+'"'),shown.includes(id),
      "Incorrect history filter "+filter+" for "+id);
  }
}
console.log("PASS: date obligations, overdue/soon badges, tire lifetime, odometer changes and three history filters");
