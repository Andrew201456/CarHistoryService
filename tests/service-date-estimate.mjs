/* Run with: node tests/service-date-estimate.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=readFileSync(resolve(root,"public/index.html"),"utf-8");
const start=source.indexOf("function estimateNextServiceDate(");
const end=source.indexOf("/* Επόμενο service */",start);
assert.ok(start>0&&end>start,"Estimator must exist before renderNext");
const intOf=s=>parseInt(String(s??"").replace(/\D/g,""),10)||0;
const estimate=new Function("intOf",source.slice(start,end)+"\nreturn estimateNextServiceDate;")(intOf);
const asOf=new Date(2026,10,22);
const history=[
 {id:"a",date:"2025-11-20",km:"140000",regular:true},
 {id:"b",date:"2026-05-20",km:"145000",regular:true},
 {id:"c",date:"2026-10-20",km:"150000",regular:true}
];

const result=estimate(history,152000,160000,asOf);
assert.ok(result?.date instanceof Date&&result.date>asOf,"Future estimate expected");
assert.equal(result.intervals,2,"Recent intervals should count");
assert.equal(result.date.toISOString().slice(0,10),"2027-08-15");
assert.equal(estimate(history.slice(0,1),151000,160000,asOf),null,"One service is insufficient");
assert.equal(estimate(history,160000,160000,asOf),null,"Already due should not show future date");
assert.equal(estimate(history,0,160000,asOf),null,"Current odometer is required");
assert.equal(estimate([{date:"2025-10-20",km:100000,regular:true},{date:"2026-10-20",km:120000,regular:false}],122000,130000,asOf),null,"Repair-only reading should not affect pace");
assert.equal(estimate([{date:"2027-01-20",km:160000,regular:true},{date:"2026-10-20",km:150000,regular:true}],152000,160000,asOf),null,"Future record is ignored");
assert.equal(estimate([{date:"2026-01-20",km:140000,regular:true},{date:"2026-10-20",km:130000,regular:true}],132000,140000,asOf),null,"Odometer reversal cannot be trusted");
assert.equal(estimate([{date:"2026-02-31",km:140000,regular:true},{date:"2026-10-20",km:150000,regular:true}],152000,160000,asOf),null,"Invalid calendar date is ignored");
assert.equal(estimate([...history,{id:"repair",date:"2026-11-01",km:151000,regular:false}],152000,160000,asOf).date.toISOString(),result.date.toISOString(),"Repairs do not change estimate");
assert.ok(source.includes("Εκτιμώμενη ημερομηνία service"),"Forecast should appear in next-service card");
console.log("PASS: recent-service pace, ETA, missing data, overdue, repairs and invalid readings");

assert.ok(source.includes('service-eta-inline'),"Forecast should use compact single-line presentation");
assert.ok(!source.includes('service-eta-body'),"Large nested ETA card should be removed");
