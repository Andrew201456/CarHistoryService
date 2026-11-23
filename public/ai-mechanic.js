/* AI Mechanic chat: local conversation, history shared only on user request. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const CHAT_KEY="carServiceAiConversationV1";
  const chat=$("aiMessages"),welcome=$("aiWelcome"),form=$("aiForm"),
    question=$("aiQuestion"),status=$("aiStatus"),send=$("aiSend");
  if(!chat||!welcome||!form||!question||!status||!send)return;
  let messages=[],busy=false;

  function savedMessages(){
    try{
      const saved=JSON.parse(localStorage.getItem(CHAT_KEY)||"[]");
      if(!Array.isArray(saved))return [];
      return saved.filter(m=>m&&["user","assistant"].includes(m.role)&&typeof m.content==="string")
        .slice(-12).map(m=>({role:m.role,content:m.content.slice(0,9000)}));
    }catch{return [];}
  }
  function persist(){
    try{localStorage.setItem(CHAT_KEY,JSON.stringify(messages.slice(-12)));}
    catch(e){console.warn("AI conversation not saved locally",e);}
  }
  function setStatus(message,error=false){
    status.textContent=message||"";
    status.classList.toggle("error",error);
  }
  function render(){
    chat.replaceChildren();
    welcome.hidden=messages.length>0;
    for(const msg of messages){
      const line=document.createElement("div");
      line.className="ai-bubble "+(msg.role==="user"?"is-user":"is-assistant");
      const heading=document.createElement("span");
      heading.className="ai-bubble-author";
      heading.textContent=msg.role==="user"?"Εσύ":"AI Μηχανικός";
      const content=document.createElement("div");
      content.className="ai-bubble-content";
      // Never inject AI text or user questions as HTML.
      content.textContent=msg.content;
      line.append(heading,content);
      chat.append(line);
    }
    if(messages.length)chat.scrollTop=chat.scrollHeight;
  }
  function updateVehicle(){
    const vehicle=String(settings.vehicleInfo||"").trim();
    $("aiVehicle").value=vehicle;
    $("aiVehicleSummary").textContent=vehicle?"Συμπληρωμένα":"Προαιρετικά";
    $("aiHistoryCount").textContent=items.length+" καταχωρήσεις service/επισκευών";
    const km=intOf(settings.current);
    $("aiCurrentKm").textContent=km?fmtKm(km):"Χιλιόμετρα: μη δηλωμένα";
  }
  function normalizedWords(value){
    return String(value||"").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .split(/[^a-z0-9\u0370-\u03ff]+/g).filter(w=>w.length>=4);
  }
  function relatedHistory(questionText){
    const sorted=[...items].filter(x=>x&&typeof x==="object")
      .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||intOf(b.km)-intOf(a.km));
    const recent=sorted.slice(0,80);
    const terms=new Set(normalizedWords(questionText));
    const older=sorted.slice(80).filter(it=>{
      if(!terms.size)return false;
      const haystack=[it.notes,it.what,...(it.parts||[]).map(p=>p.name)].join(" ");
      return normalizedWords(haystack).some(w=>terms.has(w));
    }).slice(0,40);
    return [...recent,...older].map(it=>({
      date:it.date||"",km:it.km||"",regular:it.regular!==false,
      parts:(Array.isArray(it.parts)?it.parts:[]).slice(0,12).map(p=>({name:String(p.name||"").slice(0,115)})),
      what:String(it.what||"").slice(0,250),notes:String(it.notes||"").slice(0,450)
    }));
  }
  async function ask(text){
    if(busy)return;
    const content=String(text||"").trim();
    if(content.length<5){setStatus("Περιέγραψε λίγο πιο αναλυτικά το σύμπτωμα.",true);return;}
    if(!navigator.onLine){setStatus("Χρειάζεται internet για την απάντηση του AI. Το ιστορικό σου παραμένει διαθέσιμο.",true);return;}
    let pass=localStorage.getItem(PKEY);
    if(!pass){
      pass=prompt("Κωδικός πρόσβασης στο CarHistoryService:");
      if(!pass||!pass.trim())return;
      pass=pass.trim();
      localStorage.setItem(PKEY,pass);
    }
    const prior=messages.slice(-8).map(m=>({role:m.role,content:m.content.slice(0,1200)}));
    const payload={
      question:content,
      vehicle:String(settings.vehicleInfo||""),
      currentKm:settings.current||"",
      serviceIntervalKm:settings.interval||"",
      history:relatedHistory(content),
      reminders:reminders.slice(0,30).map(r=>({name:r.name,dueKm:r.dueKm,repeatKm:r.repeatKm})),
      conversation:prior
    };
    busy=true;send.disabled=true;send.textContent="Σκέφτεται…";setStatus("Αναλύει τα service και τις πιθανές αιτίες…");
    messages.push({role:"user",content});
    render();
    try{
      const response=await fetch("/api/diagnose",{
        method:"POST",cache:"no-store",
        headers:{"Authorization":"Bearer "+pass,"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      let data={};
      try{data=await response.json();}catch{}
      if(response.status===401){
        localStorage.removeItem(PKEY);
        throw new Error("Ο κωδικός πρόσβασης δεν είναι σωστός. Δοκίμασε ξανά.");
      }
      if(!response.ok)throw new Error(data.error||"Η υπηρεσία AI δεν απάντησε ("+response.status+").");
      if(typeof data.answer!=="string"||!data.answer.trim())throw new Error("Το AI δεν επέστρεψε απάντηση.");
      messages.push({role:"assistant",content:data.answer.trim().slice(0,9000)});
      messages=messages.slice(-12);
      persist();render();question.value="";
      setStatus("Η απάντηση αξιοποίησε "+data.usedEntries+" καταχωρήσεις ιστορικού. Δεν είναι τελική διάγνωση.");
    }catch(error){
      messages.pop();render();
      setStatus(error.message||"Προέκυψε σφάλμα. Δοκίμασε ξανά.",true);
    }finally{
      busy=false;send.disabled=false;
      send.replaceChildren(document.createTextNode("Ρώτησε "));
      const icon=document.createElement("span");
      icon.setAttribute("aria-hidden","true");icon.textContent="↑";send.append(icon);
    }
  }

  messages=savedMessages();
  render();updateVehicle();
  form.addEventListener("submit",event=>{event.preventDefault();ask(question.value);});
  $("aiClear").addEventListener("click",()=>{
    if(busy)return;
    messages=[];persist();render();setStatus("");question.value="";question.focus();
  });
  $("aiSaveVehicle").addEventListener("click",()=>{
    const info=$("aiVehicle").value.trim().slice(0,150);
    if(String(settings.vehicleInfo||"")!==info){
      settings.vehicleInfo=info;store();
    }
    $("aiVehicleSummary").textContent=info?"Συμπληρωμένα":"Προαιρετικά";
    $("aiVehiclePanel").open=false;
    setStatus("Τα στοιχεία αυτοκινήτου αποθηκεύτηκαν.");
  });
  welcome.addEventListener("click",event=>{
    const button=event.target.closest("button[data-ai-example]");
    if(!button)return;
    question.value=button.dataset.aiExample||"";
    question.focus();
  });
  document.querySelector('nav button[data-v="ai"]').addEventListener("click",()=>{
    updateVehicle();
  });
  window.CarHistoryAi={selectHistory:relatedHistory};
})();