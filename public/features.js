/* CarHistoryService dashboard enhancements — classic script, no framework. */
(function initAfterAccount() {
  "use strict";
  if(!window.CarHistoryAccountReady){window.addEventListener("carhistory:ready",initAfterAccount,{once:true});return;}
  const $ = id => document.getElementById(id);
  const DRAFTKEY = "carServiceDraftV1:"+window.CarHistoryAccountScope;
  const euro = n => money(n);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  const yearNow = () => String(new Date().getFullYear());
  const costOf = item => total(item) + num(item.cost);
  const int = s => intOf(s);

  function updateOverview() {
    const now = yearNow();
    const thisYear = items.filter(it => String(it.date||"").startsWith(now));
    const yearlySpend = thisYear.reduce((sum,it)=>sum + costOf(it),0);
    $("yearSpent").textContent = euro(yearlySpend);
    $("yearSpentLabel").textContent = "Συντήρηση " + now;
    $("serviceCount").textContent = String(items.length);
  }

  function renderExpenses() {
    const sel = $("expenseYear");
    if (!sel) return;
    const available = [...new Set(items.map(it=>(it.date||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort().reverse();
    const years = ["all", ...available];
    const oldValue = sel.value || (available.includes(yearNow()) ? yearNow() : "all");
    sel.innerHTML = years.map(y=>'<option value="'+y+'">'+(y==="all"?"Όλα τα έτη":y)+'</option>').join("");
    sel.value = years.includes(oldValue) ? oldValue : (available.includes(yearNow()) ? yearNow() : "all");
    const subset = sel.value === "all" ? items : items.filter(it=>(it.date||"").startsWith(sel.value));
    const totalSpend = subset.reduce((sum,it)=>sum + costOf(it),0);
    const categories = new Map();
    for (const it of subset) {
      for (const part of (it.parts||[])) {
        const label = String(part.name||"Χωρίς όνομα").trim() || "Χωρίς όνομα";
        const amount = num(part.cost);
        if (amount) categories.set(label,(categories.get(label)||0)+amount);
      }
      const labor = num(it.labor)+num(it.cost);
      if (labor) categories.set("Εργασία / άλλα έξοδα",(categories.get("Εργασία / άλλα έξοδα")||0)+labor);
    }
    const ranked = [...categories.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7);
    $("expenseDetails").innerHTML =
      '<div class="expense-stats"><span>Σύνολο ('+subset.length+' καταχωρήσεις)</span><strong>'+euro(totalSpend)+'</strong></div>' +
      (ranked.length
        ? ranked.map(([name,amount])=>'<div class="expense-entry"><span>'+esc(name)+'</span><strong>'+euro(amount)+'</strong></div>').join("")
        : '<div class="empty-inline">Δεν υπάρχουν καταχωρημένα έξοδα για αυτό το διάστημα.</div>');
  }

  function renderReminders() {
    const c = int(settings.current), list = $("remindersList");
    const sorted = [...reminders].sort((a,b)=>int(a.dueKm)-int(b.dueKm));
    const dueSoon = c ? sorted.filter(r=>int(r.dueKm)-c<=1000).length : 0;
    $("reminderCount").textContent = sorted.length ? (dueSoon?dueSoon+" κοντά / "+sorted.length:sorted.length+" ενεργές") : "Καμία";
    if (!sorted.length) {
      list.innerHTML = '<div class="empty-inline">Δεν έχεις προσθέσει υπενθυμίσεις. Μπορείς να ξεκινήσεις με λάδια, φίλτρα ή οποιαδήποτε άλλη εργασία.</div>';
      return;
    }
    list.innerHTML = sorted.map(r=>{
      const due=int(r.dueKm),left=due-c;
      const status = c>0
        ? (left<0 ? 'Καθυστέρηση '+fmtKm(-left) : (left===0 ? 'Έφτασε η ώρα' : 'Απομένουν '+fmtKm(left)))
        : 'Στα '+fmtKm(due);
      const recurring=int(r.repeatKm)>0 ? ' · κάθε '+fmtKm(int(r.repeatKm)) : '';
      return '<div class="reminder-line"><div class="reminder-main"><strong>'+esc(r.name||"Εργασία")+'</strong>' +
        '<small class="reminder-status'+(c>0&&left<=0?' late':'')+'">'+esc(status)+'</small>' +
        (recurring?'<small>'+esc(recurring.slice(3))+'</small>':'')+'</div>' +
        '<div class="reminder-actions"><button type="button" data-done="'+esc(r.id)+'" aria-label="Ολοκληρώθηκε">Έγινε ✓</button>' +
        '<button type="button" class="remove-rem" data-remdel="'+esc(r.id)+'" aria-label="Διαγραφή υπενθύμισης">✕</button></div></div>';
    }).join("");
  }

  const obligationKinds=[
    {field:"dueInsurance",name:"Ασφάλεια",icon:"🛡️"},
    {field:"dueKteo",name:"ΚΤΕΟ",icon:"🔧"},
    {field:"dueTax",name:"Τέλη",icon:"📄"},
    {field:"dueEmissions",name:"Κάρτα καυσαερίων",icon:"🌿"}
  ];
  const DAY=86400000;
  function dateInfo(value,now=new Date()){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return null;
    const [y,m,d]=value.split("-").map(Number);
    const date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
    const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
    const days=Math.round((date.getTime()-today)/DAY);
    return {
      days,
      date:new Intl.DateTimeFormat("el-GR",{
        day:"numeric",month:"short",year:"numeric",timeZone:"UTC"
      }).format(date)
    };
  }
  function obligationState(days){
    return days<0?{className:"overdue",text:"Έληξε πριν "+(-days)+" ημέρες"}:
      days===0?{className:"overdue",text:"Λήγει σήμερα"}:
      days<=30?{className:"soon",text:days===1?"Λήγει αύριο":"Σε "+days+" ημέρες"}:
      {className:"ok",text:null};
  }
  function latestTires(){
    return items.filter(it=>itemKind(it)==="tires"&&int(it.km)>0&&int(it.tireLifeKm)>0)
      .sort((a,b)=>int(b.km)-int(a.km)||(b.date||"").localeCompare(a.date||""))[0]||null;
  }
  function renderDueSummary(){
    const cards=[];
    let urgent=0,configured=0;
    for(const kind of obligationKinds){
      const info=dateInfo(settings[kind.field]);
      const field=$(kind.field);
      if(field&&field.value!==(info?settings[kind.field]:"")){
        field.value=info?settings[kind.field]:"";
      }
      if(!info)continue;
      configured++;
      const state=obligationState(info.days);
      if(state.className!=="ok")urgent++;
      cards.push('<div class="due-chip '+state.className+'"><span class="due-chip-top">'+
        '<span class="due-icon" aria-hidden="true">'+kind.icon+'</span><span>'+
        esc(kind.name)+'</span></span><strong>'+esc(info.date)+'</strong>'+
        '<small>'+esc(state.text||"Προγραμματισμένη λήξη")+'</small></div>');
    }
    const tires=isKindVisible("tires")?latestTires():null;
    if(tires){
      const dueKm=int(tires.km)+int(tires.tireLifeKm);
      const currentKm=int(settings.current);
      const left=dueKm-currentKm;
      const state=currentKm>0?(left<=0?"overdue":left<=2000?"soon":"ok"):"ok";
      let note=currentKm>0&&currentKm<int(tires.km)?
        "Ενημέρωσε τα τωρινά χλμ. για σωστή εκτίμηση":
        currentKm>0?
          left<0?"Έχουν ξεπεραστεί κατά "+fmtKm(-left):
          left===0?"Χρειάζονται έλεγχο / αλλαγή":"Απομένουν "+fmtKm(left):
          "Προβλεπόμενη αλλαγή στα "+fmtKm(dueKm);
      if(currentKm>=int(tires.km)&&left>0){
        const estimate=estimateNextServiceDate(items,currentKm,dueKm);
        if(estimate)note+=" · περ. "+new Intl.DateTimeFormat("el-GR",{
          day:"numeric",month:"short",year:"numeric",timeZone:"UTC"
        }).format(estimate.date);
      }
      cards.push('<div class="due-chip tire-chip '+state+'"><span class="due-chip-top">'+
        '<span class="due-icon" aria-hidden="true">◉</span>Ελαστικά</span>'+
        '<strong>'+fmtKm(dueKm)+'</strong><small>'+esc(note)+'</small></div>');
    }
    $("obligationsCount").textContent=urgent?urgent+" κοντά / ληγμένα":
      configured?configured+" ημερομηνίες":"Προσθήκη";
    const target=$("dueSummary");
    if(!cards.length){
      target.innerHTML='<div class="due-empty"><div><strong>Κράτα τις προθεσμίες σου οργανωμένες</strong>'+
        '<span>Ασφάλεια, ΚΤΕΟ, τέλη και αλλαγή ελαστικών, όλα εδώ.</span></div>'+
        '<button type="button" data-due-settings>Προσθήκη ημερομηνιών</button></div>';
      return;
    }
    target.innerHTML='<div class="due-summary-heading"><strong>ΠΡΟΘΕΣΜΙΕΣ &amp; ΕΛΑΣΤΙΚΑ</strong>'+
      '<button type="button" data-due-settings aria-label="Επεξεργασία ημερομηνιών">Ημερομηνίες ⚙</button></div>'+
      '<div class="due-cards">'+cards.join("")+'</div>';
  }
  $("obligationsPanel").addEventListener("change",event=>{
    const field=event.target.id;
    if(!obligationKinds.some(kind=>kind.field===field))return;
    const value=event.target.value;
    if(value&&!dateInfo(value)){
      alert("Διάλεξε έγκυρη ημερομηνία.");
      event.target.value=settings[field]||"";
      return;
    }
    settings[field]=value;
    store();
    renderDueSummary();
  });
  $("dueSummary").addEventListener("click",event=>{
    const trigger=event.target.closest("[data-due-settings]");
    if(!trigger)return;
    const panel=$("obligationsPanel");
    panel.open=true;
    panel.scrollIntoView({behavior:"smooth",block:"center"});
  });

  function renderExtras() { updateOverview(); renderExpenses(); renderReminders(); renderDueSummary(); }
  window.renderExtras = renderExtras;
  const originalRender = render;
  render = function () { const output = originalRender(); renderExtras(); return output; };
  $("expenseYear").addEventListener("change",renderExpenses);

  // Search filters affect only the history view, never the stored records.
  document.querySelector(".filters").addEventListener("click",event=>{
    const b=event.target.closest("[data-filter]");
    if(!b)return;
    historyFilter=b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(x=>{
      const isCurrent=x===b;
      x.classList.toggle("selected",isCurrent);
      x.setAttribute("aria-pressed",String(isCurrent));
    });
    render();
  });

  // Reminder schedule is in odometer km; repetition is optional.
  $("remAdd").addEventListener("click",()=>{
    $("reminderEditor").hidden=false;
    $("remAdd").hidden=true;
    $("remName").focus();
  });
  $("remCancel").addEventListener("click",()=>{
    $("reminderEditor").hidden=true;
    $("remAdd").hidden=false;
  });
  $("remSave").addEventListener("click",()=>{
    const name=$("remName").value.trim();
    const due=int($("remDue").value);
    const repeat=int($("remRepeat").value);
    if (!name) { $("remName").focus();return; }
    if (due<=0) { alert("Συμπλήρωσε τα χιλιόμετρα που χρειάζεται η εργασία.");$("remDue").focus();return; }
    reminders.push({id:newId(),name,dueKm:due,repeatKm:repeat});
    store();renderExtras();
    ["remName","remDue","remRepeat"].forEach(id=>$(id).value="");
    $("reminderEditor").hidden=true;$("remAdd").hidden=false;
  });
  $("remindersList").addEventListener("click",event=>{
    const b=event.target.closest("button");if(!b)return;
    const del=b.dataset.remdel,done=b.dataset.done;
    if(del){
      if(!confirm("Να διαγραφεί αυτή η υπενθύμιση;"))return;
      reminders=reminders.filter(r=>String(r.id)!==del);
    }
    if(done){
      const r=reminders.find(r=>String(r.id)===done);if(!r)return;
      if(int(r.repeatKm)>0)r.dueKm=Math.max(int(r.dueKm),int(settings.current))+int(r.repeatKm);
      else reminders=reminders.filter(x=>String(x.id)!==done);
    }
    store();renderExtras();
  });

  // One-tap common jobs: use the empty part line before creating another.
  document.querySelectorAll(".quick-actions").forEach(group=>{
    group.addEventListener("click",event=>{
      const b=event.target.closest("[data-quick]");if(!b)return;
      const name=b.dataset.quick;
      const rows=[...document.querySelectorAll("#parts .prow")];
      let target=rows.find(r=>!r.querySelector(".pn").value.trim() && !r.querySelector(".pc").value.trim());
      if(!target){partRow();target=$("parts").lastElementChild}
      target.querySelector(".pn").value=name;
      target.querySelector(".pc").focus();
      updSum();saveDraft();
    });
  });

  // Draft stays on this device until explicitly saved or discarded.
  function getDraft(){
    try{
      const draft=JSON.parse(localStorage.getItem(DRAFTKEY)||"null");
      return draft&&Array.isArray(draft.parts)?draft:null;
    }catch{return null}
  }
  function saveDraft(){
    const d={
      editId:editId||null,
      date:$("date").value,km:$("km").value,
      kind:$("serviceKind").value,tireName:$("tireName").value,
      tireLifeKm:$("tireLifeKm").value,
      parts:readParts(),labor:$("labor").value,
      where:$("where").value,notes:$("notes").value,regular:$("regular").checked
    };
    try{localStorage.setItem(DRAFTKEY,JSON.stringify(d))}catch(e){console.warn("Draft could not be saved",e)}
  }
  function clearDraft(){
    localStorage.removeItem(DRAFTKEY);
    $("draftNotice").hidden=true;
  }
  const initialDraft=getDraft();
  const originalReset=resetForm;
  resetForm=function(){originalReset();clearDraft()};
  if(initialDraft){
    const match=initialDraft.editId&&items.some(i=>i.id===initialDraft.editId);
    editId=match?initialDraft.editId:null;
    $("date").value=initialDraft.date||"";
    $("km").value=initialDraft.km||"";
    $("labor").value=initialDraft.labor||"";
    $("where").value=initialDraft.where||"";
    $("notes").value=initialDraft.notes||"";
    setServiceKind(initialDraft.kind==="improvements"?"improvements":
      initialDraft.kind==="tires"?"tires":
      initialDraft.kind==="repair"||initialDraft.regular===false?"repair":"regular");
    $("tireName").value=initialDraft.tireName||"";
    $("tireLifeKm").value=initialDraft.tireLifeKm||"";
    $("parts").innerHTML="";
    (initialDraft.parts.length?initialDraft.parts:[{name:"",cost:""}]).forEach(p=>partRow(p.name,p.cost));
    $("formTitle").textContent=editId?"Επεξεργασία":"Νέα καταχώρηση";
    $("save").textContent=editId?"Αποθήκευση αλλαγών":"Αποθήκευση";
    $("cancel").hidden=!editId;
    $("navAdd").textContent=editId?"Επεξεργασία":"Προσθήκη";
    $("draftNotice").hidden=false;
    updSum();
  }
  $("draftDiscard").addEventListener("click",()=>resetForm());
  $("v-form").addEventListener("input",event=>{
    if (event.target.closest("input,textarea")) saveDraft();
  });
  $("v-form").addEventListener("change",event=>{
    if (event.target.closest("input,textarea,select")) saveDraft();
  });
  $("addPart").addEventListener("click",saveDraft);
  $("parts").addEventListener("click",event=>{
    if(event.target.closest(".rm"))saveDraft();
  });
  $("list").addEventListener("click",event=>{
    if(event.target.closest("[data-e]")){
      // The original handler has already populated the edit form.
      saveDraft();
      $("draftNotice").hidden=true;
    }
  });

  // PWA: Android native install prompt, concise manual Safari guidance.
  (function setupInstall(){
    const button=$("installBtn"),help=$("installHelp");
    if(!button||!help)return;
    const ua=navigator.userAgent||"";
    const ios=/iPad|iPhone|iPod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const android=/Android/i.test(ua);
    const standalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
    let deferred=null,installed=false;
    function visible(){button.hidden=installed||standalone()||!(ios||android||deferred)}
    window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;visible()});
    window.addEventListener("appinstalled",()=>{installed=true;deferred=null;visible()});
    button.addEventListener("click",async()=>{
      if(standalone())return;
      if(deferred){
        const choice=deferred;deferred=null;
        try{
          await choice.prompt();
          const result=await choice.userChoice;
          if(result.outcome==="accepted"){button.hidden=true;return}
        }catch(e){console.warn("Native prompt failed",e)}
      }
      $("installHelpText").textContent=ios ?
        "Στο Safari πάτησε «Κοινοποίηση» → «Προσθήκη στην Αρχική οθόνη» → «Προσθήκη». Αν είσαι σε άλλον browser, άνοιξε πρώτα την εφαρμογή στο Safari." :
        "Στο μενού ⋮ του Chrome πάτησε «Εγκατάσταση εφαρμογής» ή «Προσθήκη στην αρχική οθόνη».";
      if(!help.open)help.showModal();
      visible();
    });
    $("installDismiss").addEventListener("click",()=>help.close());
    matchMedia("(display-mode: standalone)").addEventListener?.("change",visible);
    window.addEventListener("pageshow",visible);
    visible();
    if("serviceWorker" in navigator && (location.protocol==="https:"||location.hostname==="localhost")){
      navigator.serviceWorker.register("/sw.js").catch(e=>console.info("Offline shell unavailable",e));
    }
  })();

  renderExtras();
})();
