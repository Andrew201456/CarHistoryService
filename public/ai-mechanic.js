/* AI Mechanic — clean chat + structured, synced vehicle profile. */
(function initAfterAccount() {
  "use strict";
  if(!window.CarHistoryAccountReady){window.addEventListener("carhistory:ready",initAfterAccount,{once:true});return;}
  const $ = id => document.getElementById(id);
  const CHAT_KEY="carServiceAiConversationV1:"+window.CarHistoryAccountScope;
  const CHAT_LIMIT=48;
  const RECENT_LIMIT=12;
  const fieldMap={
    make:"aiCarMake",model:"aiCarModel",year:"aiCarYear",fuel:"aiCarFuel",
    engine:"aiCarEngine",cc:"aiCarCc",power:"aiCarPower",gearbox:"aiCarGearbox",
    trim:"aiCarTrim",vin:"aiCarVin",notes:"aiCarNotes"
  };
  const fieldMax={make:70,model:70,year:4,fuel:25,engine:100,cc:5,power:4,gearbox:30,trim:100,vin:17,notes:350};
  const chat=$("aiMessages"),welcome=$("aiWelcome"),form=$("aiForm"),
    question=$("aiQuestion"),status=$("aiStatus"),send=$("aiSend"),
    profileDialog=$("aiVehicleDialog"),profileForm=$("aiVehicleForm");
  if(!chat||!welcome||!form||!question||!status||!send||!profileDialog||!profileForm)return;
  let messages=[],busy=false;

  function loadMessages(){
    try{
      const data=JSON.parse(localStorage.getItem(CHAT_KEY)||"[]");
      if(!Array.isArray(data))return [];
      return data.filter(m=>m&&["user","assistant"].includes(m.role)&&typeof m.content==="string")
        .slice(-CHAT_LIMIT).map(m=>({
          role:m.role,content:m.content.slice(0,9000),
          usedEntries:Number.isInteger(m.usedEntries)?Math.max(0,m.usedEntries):null
        }));
    }catch{return []}
  }
  function persist(){
    try{localStorage.setItem(CHAT_KEY,JSON.stringify(messages.slice(-CHAT_LIMIT)))}
    catch(e){console.warn("AI conversation not saved locally",e)}
  }
  function setStatus(message,error=false){
    status.textContent=message||"";
    status.classList.toggle("error",error);
  }
  function setBusy(active){
    busy=active;send.disabled=active;
    send.classList.toggle("is-busy",active);
    send.setAttribute("aria-label",active?"Αναμονή απάντησης AI":"Αποστολή ερώτησης");
  }
  function makeIcon(){
    const icon=document.createElement("span");
    icon.className="ai-message-logo";
    icon.setAttribute("aria-hidden","true");
    icon.textContent="✦";
    return icon;
  }
  function render(){
    chat.replaceChildren();
    welcome.hidden=messages.length>0;
    for(const msg of messages){
      const line=document.createElement("article");
      line.className="ai-message "+(msg.role==="user"?"is-user":"is-assistant");
      if(msg.role==="assistant")line.append(makeIcon());
      const body=document.createElement("div");
      body.className="ai-message-body";
      const content=document.createElement("div");
      content.className="ai-message-text";
      content.textContent=msg.content; // No AI or user HTML execution.
      body.append(content);
      if(msg.role==="assistant"&&Number.isInteger(msg.usedEntries)){
        const meta=document.createElement("small");
        meta.className="ai-message-meta";
        meta.textContent="Με βάση "+msg.usedEntries+" καταχωρήσεις ιστορικού";
        body.append(meta);
      }
      line.append(body);
      chat.append(line);
    }
    if(messages.length)chat.scrollTop=chat.scrollHeight;
  }
  function safeField(value,key){
    const text=String(value==null?"":value).trim();
    return (key==="vin"?text.toUpperCase():text).slice(0,fieldMax[key]);
  }
  function getProfile(){
    // vehicleProfile is part of the existing synced settings, no database change.
    if(settings.vehicleProfile&&typeof settings.vehicleProfile==="object"&&!Array.isArray(settings.vehicleProfile)){
      return Object.fromEntries(Object.keys(fieldMap).map(k=>[k,safeField(settings.vehicleProfile[k],k)]));
    }
    // Bring forward free-text vehicle data from the previous version without losing it.
    const legacy=String(settings.vehicleInfo||"").trim();
    return Object.fromEntries(Object.keys(fieldMap).map(k=>[k,k==="notes"?legacy.slice(0,350):""]));
  }
  function hasProfile(profile){
    return Object.values(profile).some(v=>String(v).trim());
  }
  function updateVehicle(){
    const p=getProfile();
    const title=[p.make,p.model,p.year].filter(Boolean).join(" ");
    $("aiVehicleSummary").textContent=title||"Πρόσθεσε το αυτοκίνητό σου";
    // Keep the home page title in sync immediately after editing the vehicle,
    // without requiring a reload or another authenticated cloud sync.
    window.CarHistoryUpdateHomeTitle?.();
    const details=[p.engine,p.fuel,p.trim].filter(Boolean);
    $("aiVehicleSubtitle").textContent=details.join(" · ")||(
      hasProfile(p)?"Άνοιξε για επεξεργασία":"Μάρκα, μοντέλο, χρονιά, κινητήρας…"
    );
    $("aiHistoryCount").textContent=items.length+" καταχωρήσεις";
    const km=intOf(settings.current);
    $("aiCurrentKm").textContent=km?fmtKm(km):"Χλμ. μη δηλωμένα";
  }
  function openProfile(){
    const p=getProfile();
    for(const [key,id] of Object.entries(fieldMap))if($(id))$(id).value=p[key];
    for(const key of ["year","cc","power","vin"])$(fieldMap[key])?.setCustomValidity("");
    profileDialog.showModal();
  }
  function closeProfile(){profileDialog.close();}
  function saveProfile(event){
    event.preventDefault();
    const values=Object.fromEntries(Object.entries(fieldMap)
      .map(([key,id])=>[key,safeField($(id)?.value ?? settings.vehicleProfile?.[key],key)]));
    if(values.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(values.vin)){
      $("aiCarVin")?.setCustomValidity("Το VIN πρέπει να έχει 17 χαρακτήρες, χωρίς I, O ή Q.");
      $("aiCarVin")?.reportValidity();return;
    }
    const year=values.year;
    if(year && (!/^\d{4}$/.test(year)||Number(year)<1886||Number(year)>new Date().getFullYear()+1)){
      $("aiCarYear").setCustomValidity("Βάλε έγκυρη χρονολογία αυτοκινήτου.");
      $("aiCarYear").reportValidity();
      return;
    }
    $("aiCarYear").setCustomValidity("");
    for(const key of ["cc","power"]){
      const input=$(fieldMap[key]),value=values[key];
      if(value && (!/^\d+$/.test(value)||Number(value)<1||
        Number(value)>(key==="cc"?16000:3000))){
        input.setCustomValidity("Συμπλήρωσε μόνο έγκυρο αριθμό.");
        input.reportValidity();return;
      }
    }
    settings.vehicleProfile=values;
    store(); // existing local storage + authenticated cross-device sync
    updateVehicle();
    closeProfile();
    setStatus("Τα στοιχεία του αυτοκινήτου αποθηκεύτηκαν.");
  }
  function words(value){
    return String(value||"").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .split(/[^a-z0-9\u0370-\u03ff]+/g).filter(w=>w.length>=4);
  }
  function relatedHistory(questionText){
    const sorted=[...items].filter(x=>x&&typeof x==="object")
      .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||intOf(b.km)-intOf(a.km));
    // Put relevant older work ahead of the rest of the recent history so the
    // server's context budget cannot crowd it out on long service logs.
    const recent=sorted.slice(0,30);
    const terms=new Set(words(questionText));
    const relevant=sorted.slice(30).map(it=>{
      const haystack=[it.notes,it.what,...(Array.isArray(it.parts)?it.parts:[]).map(p=>p.name)].join(" ");
      const score=[...new Set(words(haystack))].filter(w=>terms.has(w)).length;
      return {it,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,40).map(x=>x.it);
    const prioritized=new Set([...recent,...relevant]);
    const additional=sorted.slice(0,80).filter(it=>!prioritized.has(it));
    return [...recent,...relevant,...additional].map(it=>({
      date:it.date||"",km:it.km||"",regular:it.regular!==false,kind:itemKind(it),
      parts:(Array.isArray(it.parts)?it.parts:[]).slice(0,12)
        .map(p=>({name:String(p.name||"").slice(0,115)})),
      what:String(it.what||"").slice(0,250),notes:String(it.notes||"").slice(0,450)
    }));
  }
  function conversationContext(){
    const previous=messages.slice(-CHAT_LIMIT);
    return previous.map((m,i)=>{
      const recent=i>=previous.length-RECENT_LIMIT;
      const limit=recent?(m.role==="user"?1800:2600):(m.role==="user"?1000:600);
      return {role:m.role,content:m.content.slice(0,limit)};
    });
  }
  async function ask(text){
    if(busy)return;
    const content=String(text||"").trim();
    if(!content){setStatus("Γράψε την ερώτηση ή την απάντησή σου.",true);return}
    if(content.length>1800){setStatus("Το μήνυμα πρέπει να έχει έως 1800 χαρακτήρες.",true);return}
    if(!navigator.onLine){
      setStatus("Χρειάζεται internet για την απάντηση. Το ιστορικό σου παραμένει διαθέσιμο.",true);
      return;
    }
    const pass=ACTIVE_TOKEN;
    if(!pass||!accountIsCurrent()){setStatus("Συνδέσου στον λογαριασμό σου.",true);return;}
    const previous=conversationContext();
    const topic=[content,...previous.filter(m=>m.role==="user").map(m=>m.content)].join(" ");
    const payload={
      question:content,vehicle:Object.fromEntries(Object.entries(getProfile()).filter(([key])=>key!=="vin")),currentKm:settings.current||"",
      serviceIntervalKm:settings.interval||"",history:relatedHistory(topic),
      reminders:reminders.slice(0,30).map(r=>({name:r.name,dueKm:r.dueKm,repeatKm:r.repeatKm})),
      conversation:previous
    };
    setBusy(true);setStatus(previous.length?"Σκέφτομαι την απάντηση…":"Ελέγχω το ιστορικό…");
    messages.push({role:"user",content});
    render();
    try{
      const response=await fetch("/api/diagnose",{
        method:"POST",cache:"no-store",
        headers:{"Authorization":"Bearer "+pass,"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      let data={};try{data=await response.json()}catch{}
      if(response.status===401){
        window.CarAccountLock?.();
        throw new Error("Η σύνδεση έληξε.");
      }
      if(!response.ok)throw new Error(data.error||"Το AI δεν απάντησε ("+response.status+").");
      if(!accountIsCurrent()||ACTIVE_TOKEN!==pass)throw new Error("Η συνεδρία άλλαξε. Συνδέσου ξανά.");
      if(typeof data.answer!=="string"||!data.answer.trim())throw new Error("Το AI δεν επέστρεψε απάντηση.");
      messages.push({role:"assistant",content:data.answer.trim().slice(0,9000),
        usedEntries:Number.isInteger(data.usedEntries)?data.usedEntries:null});
      messages=messages.slice(-CHAT_LIMIT);
      persist();render();question.value="";setStatus("");
    }catch(error){
      messages.pop();render();setStatus(error.message||"Προέκυψε σφάλμα. Δοκίμασε ξανά.",true);
    }finally{setBusy(false)}
  }

  messages=loadMessages();
  render();updateVehicle();
  form.addEventListener("submit",event=>{event.preventDefault();ask(question.value)});
  $("aiClear").addEventListener("click",()=>{
    if(busy)return;
    if(messages.length&&!window.confirm("Να ξεκινήσει νέα συνομιλία; Η προηγούμενη συζήτηση θα διαγραφεί από αυτή τη συσκευή."))return;
    messages=[];persist();render();setStatus("");question.value="";question.focus();
  });
  $("aiProfileOpen").addEventListener("click",openProfile);
  $("aiProfileClose").addEventListener("click",closeProfile);
  $("aiProfileCancel").addEventListener("click",closeProfile);
  profileForm.addEventListener("submit",saveProfile);
  for(const key of ["year","cc","power","vin"]){
    $(fieldMap[key])?.addEventListener("input",event=>event.target.setCustomValidity(""));
  }
  profileDialog.addEventListener("click",event=>{
    if(event.target===profileDialog)closeProfile();
  });
  welcome.addEventListener("click",event=>{
    const button=event.target.closest("button[data-ai-example]");
    if(!button)return;
    question.value=button.dataset.aiExample||"";question.focus();
  });
  document.querySelector('nav button[data-v="ai"]').addEventListener("click",updateVehicle);
  window.CarHistoryAi={selectHistory:relatedHistory,updateVehicle,getProfile};
})();