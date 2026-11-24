/* Car History · Device-only document wallet.
   File blobs remain in per-browser IndexedDB, scoped to the authenticated account.
   NEVER upload documents to /api or include them in the synchronized history. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const dbName="carhistory-documents-v1";
  const maxSize=25*1024*1024;
  const types={
    insurance:"Ασφαλιστήριο / πράσινη κάρτα",
    kteo:"Δελτίο ΚΤΕΟ",
    license:"Δίπλωμα οδήγησης",
    registration:"Άδεια κυκλοφορίας",
    tax:"Τέλη κυκλοφορίας",
    emissions:"Κάρτα καυσαερίων",
    roadside:"Οδική βοήθεια",
    receipt:"Τιμολόγιο / απόδειξη",
    other:"Άλλο έγγραφο"
  };
  let database=null,currentScope="",loadingSerial=0,submitted=false;
  const objectUrls=new Set();
  const form=$("documentForm"), list=$("documentsList"),status=$("documentStatus");
  if(!form||!list)return;

  function clearUrls(){
    for(const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }
  function notify(message,isError=false){
    status.textContent=message;
    status.classList.toggle("error",isError);
  }
  function request(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error("Σφάλμα τοπικής αποθήκευσης."));
    });
  }
  async function openDB(){
    if(database)return database;
    if(!("indexedDB" in window))throw new Error("Η συσκευή δεν υποστηρίζει αποθήκευση εγγράφων.");
    database=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(dbName,1);
      r.onupgradeneeded=()=>{
        const store=r.result.createObjectStore("documents",{keyPath:"key"});
        store.createIndex("byScope","scope",{unique:false});
      };
      r.onsuccess=()=>{
        r.result.onversionchange=()=>{r.result.close();database=null;};
        resolve(r.result);
      };
      r.onerror=()=>reject(r.error||new Error("Δεν άνοιξε η αποθήκη εγγράφων."));
      r.onblocked=()=>reject(new Error("Κλείσε άλλες καρτέλες της εφαρμογής και δοκίμασε ξανά."));
    });
    return database;
  }
  async function listScope(scope){
    const db=await openDB();
    const tx=db.transaction("documents","readonly");
    return request(tx.objectStore("documents").index("byScope").getAll(scope));
  }
  async function write(record){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("documents","readwrite");
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error("Δεν αποθηκεύτηκε το έγγραφο."));
      tx.onabort=()=>reject(tx.error||new Error("Η αποθήκευση διακόπηκε."));
      tx.objectStore("documents").put(record);
    });
  }
  async function erase(key){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("documents","readwrite");
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error("Δεν διαγράφηκε το έγγραφο."));
      tx.onabort=()=>reject(tx.error||new Error("Η διαγραφή διακόπηκε."));
      tx.objectStore("documents").delete(key);
    });
  }
  function allowed(file){
    return file && file.size>0 && file.size<=maxSize &&
      (file.type==="application/pdf" || file.type.startsWith("image/") ||
      /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name));
  }
  function el(tag,className,text){
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function bytes(n){
    return n<1024*1024?Math.ceil(n/1024)+" KB":(n/1024/1024).toFixed(1)+" MB";
  }
  function validExpiry(value){
    if(!value)return true;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+"T00:00:00Z");
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function expiryLabel(value){
    if(!value||!validExpiry(value))return "";
    const [y,m,d]=value.split("-");
    return " · λήξη "+d+"/"+m+"/"+y;
  }
  function render(records){
    clearUrls();
    list.replaceChildren();
    $("documentsCount").textContent=String(records.length);
    if(!records.length){
      list.append(el("p","documents-empty","Δεν υπάρχουν ακόμη αποθηκευμένα έγγραφα."));
      return;
    }
    records.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    for(const doc of records){
      const row=el("div","document-row");
      const type=el("span","document-kind",doc.mime==="application/pdf"?"PDF":"📄");
      const info=el("div","document-info");
      const title=el("strong","",doc.title||types[doc.kind]||"Έγγραφο");
      const details=el("small","", (types[doc.kind]||"Άλλο")+" · "+bytes(doc.size||0)+expiryLabel(doc.expiry));
      info.append(title,details);
      const actions=el("div","document-actions");
      const url=URL.createObjectURL(doc.blob);
      objectUrls.add(url);
      const view=el("a","doc-open","Άνοιγμα");
      view.href=url;
      view.target="_blank";
      view.rel="noopener noreferrer";
      view.setAttribute("aria-label","Άνοιγμα "+(doc.title||types[doc.kind]||"εγγράφου"));
      const save=el("a","doc-download","Λήψη");
      save.href=url;
      save.download=doc.fileName||"έγγραφο";
      save.setAttribute("aria-label","Λήψη "+(doc.title||types[doc.kind]||"εγγράφου"));
      const del=el("button","doc-delete","×");
      del.type="button";
      del.setAttribute("aria-label","Διαγραφή εγγράφου");
      del.addEventListener("click",async()=>{
        if(!confirm("Να διαγραφεί το έγγραφο από αυτή τη συσκευή;"))return;
        try{
          await erase(doc.key);
          notify("Το έγγραφο διαγράφηκε.");
          await refresh();
        }catch(error){notify(error.message,true);}
      });
      actions.append(view,save,del);
      row.append(type,info,actions);
      list.append(row);
    }
  }
  async function refresh(){
    const scope=currentScope;
    const serial=++loadingSerial;
    if(!scope)return;
    try{
      const saved=await listScope(scope);
      if(serial!==loadingSerial||scope!==currentScope)return;
      render(saved);
    }catch(error){
      if(serial===loadingSerial)notify("Δεν ανοίγουν τα αποθηκευμένα έγγραφα: "+error.message,true);
    }
  }
  async function accountReady(){
    const scope=window.CarHistoryAccountReady ? window.CarHistoryAccountScope : "";
    if(!/^[0-9a-f]{64}$/.test(scope||""))return;
    if(currentScope!==scope){
      currentScope=scope;
      clearUrls();
      form.reset();
      notify("");
      list.replaceChildren();
      $("documentsCount").textContent="0";
    }
    await refresh();
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(submitted||!currentScope||document.body.classList.contains("account-locked"))return;
    const file=$("documentFile").files?.[0];
    if(!allowed(file)){
      notify("Επίλεξε PDF ή φωτογραφία έως 25 MB.",true);
      return;
    }
    const expiry=$("documentExpiry").value;
    if(!validExpiry(expiry)){
      notify("Διάλεξε έγκυρη ημερομηνία λήξης.",true);
      return;
    }
    const kind=$("documentKind").value;
    submitted=true;
    $("documentSave").disabled=true;
    notify("Αποθήκευση στη συσκευή…");
    const scope=currentScope;
    try{
      if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
      const id=crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
      await write({
        key:scope+":"+id,id,scope,kind:types[kind]?kind:"other",
        title:$("documentTitle").value.trim().slice(0,100),
        expiry,fileName:file.name.split(/[\\/]/).pop().slice(0,160),
        mime:file.type||"application/octet-stream",size:file.size,
        blob:file,createdAt:Date.now()
      });
      if(scope===currentScope){
        form.reset();
        notify("Το έγγραφο αποθηκεύτηκε σε αυτή τη συσκευή.");
        await refresh();
      }
    }catch(error){
      notify("Δεν αποθηκεύτηκε. Έλεγξε τον ελεύθερο χώρο: "+error.message,true);
    }finally{
      submitted=false;
      $("documentSave").disabled=false;
    }
  });
  window.addEventListener("carhistory:ready",()=>{accountReady();});
  window.addEventListener("pagehide",clearUrls);
  if(window.CarHistoryAccountReady) accountReady();
})();
