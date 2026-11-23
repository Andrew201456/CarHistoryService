/* Run with Node 20+: node tests/account-preferences-improvements.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=readFileSync(resolve(root,"public/index.html"),"utf8");
const features=readFileSync(resolve(root,"public/features.js"),"utf8");
const styles=readFileSync(resolve(root,"public/ui.css"),"utf8");
const required=["regular","repair","tires","improvements"];
const gate=source.slice(source.indexOf('<section id="accountGate"'),
  source.indexOf('<section class="view" id="v-list">'));
assert(gate.includes("account-login-subtitle"),"Login should have a small welcome subtitle");
assert(source.includes('id="v-account"'),"Account must replace backup tab");
assert(source.includes('data-v="account"'));
assert(!source.includes('data-v="backup"'));
assert(!source.includes('id="v-backup"'));
assert(source.includes('class="account-advanced"'),"Recovery tools must be accessible, but collapsed");
for(const id of ["mk","cp","rs","chpw","accountShowCode","legacyTransfer"]){
  assert(source.includes('id="'+id+'"'),"Preserve original account/recovery hook "+id);
}
for(const category of required){
  assert(source.includes('data-visible-kind="'+category+'"'));
  assert(source.includes('data-filter="'+category+'"'));
  assert(source.includes('value="'+category+'"'),"Entry form must allow "+category);
}
assert(source.includes('data-quick="Stage 1 / ECU remap"'));
assert(source.includes('data-quick="Εξάτμιση"'));
assert(source.includes('regular:kind==="regular",kind'));
assert(source.includes('const visible=sorted.filter(it=>isKindVisible(itemKind(it)))'));
assert(source.includes('button.hidden=kind!=="all"&&!isKindVisible(kind)'));
assert(source.includes('itemKind(item)!=="regular"'),"Improvements must not affect scheduled service");
assert(features.includes('document.querySelectorAll(".quick-actions").forEach'));
assert(features.includes('initialDraft.kind==="improvements"'));
assert(features.includes('closest("input,textarea,select")'));
assert(features.includes('isKindVisible("tires")?latestTires():null'));
assert(styles.includes('.account-category-option input:checked+.account-switch'));
assert(styles.includes('.filters button[hidden],.quick-actions[hidden]{display:none!important}'));

// Exercise the real category helpers using a small document mock.
const ids=["serviceKind","regular","kmFieldLabel","tireFields","improvementQuickActions",
  "regularQuickActions","serviceKindHint","accountEntriesCount","accountCategorySettings"];
const fields=Object.fromEntries(ids.map(id=>[id,{
  id,value:"",textContent:"",hidden:false,checked:false,listeners:{},
  addEventListener(name,cb){this.listeners[name]=cb}
}]));
const checkboxes=required.map(visibleKind=>({
  dataset:{visibleKind},checked:false
}));
const document={querySelectorAll(selector){
  if(selector==="[data-visible-kind]")return checkboxes;
  throw Error("Unexpected selector: "+selector);
}};
let settings={current:"150000",interval:10000};
let saveCount=0,renderCount=0;
const helperSource=source.slice(source.indexOf('const HISTORY_KINDS='),
  source.indexOf('$("serviceKind").addEventListener'));
const helpers=new Function("settings","document","$","store","render",helperSource+
  ";return {itemKind,isKindVisible,renderAccountPreferences,setServiceKind};")(
  settings,document,id=>fields[id],()=>saveCount++,()=>renderCount++
);
const kinds=[
  {regular:true},                 // legacy maintenance
  {regular:false},                // legacy repair
  {kind:"tires",regular:false},
  {kind:"improvements",regular:false,parts:[{name:"Stage 1",cost:"250"}]}
];
assert.deepEqual(kinds.map(helpers.itemKind),required);
assert(required.every(helpers.isKindVisible),"All categories default visible");
helpers.renderAccountPreferences();
assert(checkboxes.every(box=>box.checked));
helpers.setServiceKind("improvements");
assert.equal(fields.serviceKind.value,"improvements");
assert.equal(fields.regular.checked,false);
assert.equal(fields.tireFields.hidden,true);
assert.equal(fields.improvementQuickActions.hidden,false);
assert.equal(fields.regularQuickActions.hidden,true);
assert.match(fields.serviceKindHint.textContent,/Stage 1/);
helpers.setServiceKind("tires");
assert.equal(fields.tireFields.hidden,false);
assert.equal(fields.improvementQuickActions.hidden,true);

// Toggling affects display settings only; it does not touch stored records.
const before=JSON.stringify(kinds);
fields.accountCategorySettings.listeners.change({
  target:{dataset:{visibleKind:"repair"},checked:false}
});
assert.equal(settings.homeVisibleKinds.repair,false);
assert.equal(helpers.isKindVisible("repair"),false);
assert.equal(helpers.isKindVisible("improvements"),true);
assert.equal(saveCount,1);
assert.equal(renderCount,1);
assert.equal(JSON.stringify(kinds),before);
helpers.renderAccountPreferences();
assert.equal(checkboxes.find(x=>x.dataset.visibleKind==="repair").checked,false);
fields.accountCategorySettings.listeners.change({
  target:{dataset:{visibleKind:"repair"},checked:true}
});
assert(helpers.isKindVisible("repair"));
assert.equal(saveCount,2);
assert.equal(renderCount,2);

console.log("PASS: Account tab, hidden recovery tools, improvements, personal visibility and no deleted history");
