/* CarHistoryService synced document wallet.
   Cloudflare per-account Durable Object stores 384KiB chunks, requiring
   authenticated /api/documents requests. IndexedDB is an offline cache and
   migration source; never claim a file is in the cloud until complete returns. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const DB="carhistory-documents-v1",LIMIT=25*1024*1024;
  const NAMES={
    insurance:"Ασφαλιστήριο / πράσινη κάρτα",kteo:"Δελτίο ΚΤΕΟ",
    tax:"Τέλη κυκλοφορίας",emissions:"Κάρτα καυσαερίων",
    license:"Δίπλωμα οδήγησης",registration:"Άδεια κυκλοφορίας",
    roadside:"Οδική βοήθεια",receipt:"Τιμολόγιο / απόδειξη",other:"Άλλο έγγραφο"
  };
  const MIME={pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",
    png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif"};
  const form=$("documentForm"),list=$("documentsList"),message=$("documentStatus");
  if(!form||!list)return;
  let scope="",db=null,cloud=[],local=[],merged=[],cloudReady=false,busy=false,migrating=false,
    refreshSerial=0,previewSerial=0,previewUrl=null;
  function notice(value,error=false){
    message.textContent=value||"";
    message.classList.toggle("error",error);
  }
  function element(tag,cls,text){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=text;
    return n;
  }
  function safeMime(file){
    const ext=(file.name.split(".").pop()||"").toLowerCase();
    const type=MIME[ext];
    if(!type||file.size<=0||file.size>LIMIT)return null;
    if(file.type&&file.type!=="application/octet-stream"&&file.type!==type)return null;
    return type;
  }
  function goodDate(s){
    if(!s)return true;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
    const d=new Date(s+"T00:00:00Z");
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
  }
  function costValue(s){return s===""?"":Number(s);}
  function formatBytes(size){
    return size>=1048576?(size/1048576).toFixed(1)+" MB":Math.ceil(size/1024)+" KB";
  }
  function recordKey(value){return scope+":"+value;}
  function req(r){
    return new Promise((resolve,reject)=>{
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error||new Error("Σφάλμα τοπικής αποθήκευσης."));
    });
  }
  async function openDB(){
    if(db)return db;
    if(!window.indexedDB)throw Error("Τοπική αποθήκευση μη διαθέσιμη.");
    db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{
        const store=r.result.createObjectStore("documents",{keyPath:"key"});
        store.createIndex("byScope","scope",{unique:false});
      };
      r.onsuccess=()=>{
        r.result.onversionchange=()=>{r.result.close();db=null;};
        resolve(r.result);
      };
      r.onerror=()=>reject(r.error||Error("Δεν ανοίγει η τοπική αποθήκη."));
      r.onblocked=()=>reject(Error("Κλείσε άλλες καρτέλες της εφαρμογής."));
    });
    return db;
  }
  async function allLocal(forScope){
    const base=await openDB();
    return req(base.transaction("documents","readonly")
      .objectStore("documents").index("byScope").getAll(forScope));
  }
  async function writeLocal(item){
    const base=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=base.transaction("documents","readwrite");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||Error("Δεν αποθηκεύτηκε το τοπικό αντίγραφο."));
      tx.onabort=()=>reject(tx.error||Error("Η αποθήκευση διακόπηκε."));
      tx.objectStore("documents").put(item);
    });
  }
  async function deleteLocal(key){
    const base=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=base.transaction("documents","readwrite");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||Error("Δεν διαγράφηκε το τοπικό αντίγραφο."));
      tx.objectStore("documents").delete(key);
    });
  }
  function token(){
    let session;
    try{session=JSON.parse(localStorage.getItem("carServiceActiveAccountV3")||"null");}
    catch{}
    if(!scope||session?.scope!==scope||typeof session?.session!=="string")
      throw Error("Συνδέσου ξανά στον λογαριασμό σου.");
    return session.session;
  }
  async function api(path,{method="GET",json,body,asBlob=false}={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    let response;
    try{
      response=await fetch(path,{method,cache:"no-store",credentials:"same-origin",
        signal:controller.signal,
        headers:{"Authorization":"Bearer "+token(),
          ...(json!==undefined?{"Content-Type":"application/json"}:
            body?{"Content-Type":"application/octet-stream"}:{})},
        ...(method==="GET"?{}:{body:json!==undefined?JSON.stringify(json):body||null})
      });
      if(asBlob&&response.ok)return response.blob();
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){
        const e=Error(payload.error||
          (response.status===404?"Η ενημέρωση Cloudflare δεν έχει δημοσιευθεί ακόμη.":
            "Το Cloudflare δεν μπόρεσε να αποθηκεύσει το αρχείο."));
        e.status=response.status;
        throw e;
      }
      return payload;
    }catch(error){
      if(error.name==="AbortError")throw Error("Η σύνδεση καθυστέρησε. Δοκίμασε ξανά.");
      throw error;
    }finally{clearTimeout(timer);}
  }
  async function upload(record){
    if(record.scope!==scope)throw Error("Ο λογαριασμός άλλαξε.");
    const result=await api("/api/documents",{method:"POST",json:{
      clientKey:record.id,kind:record.kind,title:record.title||"",
      expiry:record.expiry||"",cost:record.cost??"",mime:record.mime,
      fileName:record.fileName,size:record.size
    }});
    if(!result?.id||!Number.isInteger(result.chunkSize)||result.chunkSize<65536)
      throw Error("Το Cloudflare επέστρεψε μη έγκυρη απάντηση.");
    if(result.status!=="ready"){
      const count=Math.ceil(record.size/result.chunkSize);
      for(let n=0;n<count;n++){
        if(record.scope!==scope)throw Error("Ο λογαριασμός άλλαξε.");
        const chunk=record.blob.slice(n*result.chunkSize,(n+1)*result.chunkSize);
        await api("/api/documents/"+result.id+"/chunk/"+n,{method:"PUT",body:chunk});
        notice("Μεταφόρτωση "+(Math.round((n+1)/count*100))+"% · "+record.fileName);
      }
      await api("/api/documents/"+result.id+"/complete",{method:"POST"});
    }
    return result.id;
  }
  function mixRecords(){
    const byKey=new Map(local.map(x=>[x.id,x]));
    const included=new Set();
    merged=cloud.map(remote=>{
      included.add(remote.clientKey);
      const cached=byKey.get(remote.clientKey);
      return {...remote,remoteId:remote.id,cacheKey:cached?.key,
        blob:cached?.blob,cloud:true};
    });
    for(const cached of local)if(!included.has(cached.id)&&(!cloudReady||!cached.cloudId)){
      merged.push({...cached,cloud:false});
    }
    merged.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }
  function redraw(){
    mixRecords();
    list.replaceChildren();
    $("documentsCount").textContent=String(merged.length);
    if(!merged.length){
      list.append(element("p","documents-empty","Δεν υπάρχουν ακόμη έγγραφα."));
    }
    for(const item of merged){
      const row=element("div","document-row");
      row.dataset.documentKind=item.kind;
      const icon=element("span","document-kind",item.mime==="application/pdf"?"PDF":"▣");
      const info=element("div","document-info");
      const name=element("strong","",item.title||NAMES[item.kind]||"Έγγραφο");
      const infoBits=[NAMES[item.kind]||"Άλλο",formatBytes(item.size)];
      if(item.expiry){
        const [y,m,d]=item.expiry.split("-");
        infoBits.push("Λήξη "+d+"/"+m+"/"+y);
      }
      if(item.cost!==""&&item.cost!=null)infoBits.push(Number(item.cost).toLocaleString("el-GR")+" €");
      info.append(name,element("small","",infoBits.join(" · ")));
      if(!item.cloud)info.append(element("small","document-pending","Μόνο στη συσκευή · εκκρεμεί αποθήκευση στο cloud"));
      const actions=element("div","document-actions");
      const open=element("button","doc-open","Άνοιγμα");
      open.type="button";open.addEventListener("click",()=>openDocument(item));
      const download=element("button","doc-download","Λήψη");
      download.type="button";download.addEventListener("click",()=>downloadDocument(item));
      const del=element("button","doc-delete","×");
      del.type="button";del.setAttribute("aria-label","Διαγραφή εγγράφου");
      del.addEventListener("click",async()=>{
        if(!confirm("Να διαγραφεί αυτό το έγγραφο από τον λογαριασμό και τη συσκευή;"))return;
        const owner=scope;
        try{
          if(item.cloud)await api("/api/documents/"+item.remoteId,{method:"DELETE"});
          if(owner!==scope)return;
          if(item.cacheKey||item.key)await deleteLocal(item.cacheKey||item.key);
          notice("Το έγγραφο διαγράφηκε.");
          await refresh();
        }catch(error){notice(error.message,true);}
      });
      actions.append(open,download,del);
      row.append(icon,info,actions);
      list.append(row);
    }
    window.renderExtras?.();
  }
  async function getBlob(item){
    if(item.blob)return item.blob;
    if(!item.cloud)throw Error("Το αρχείο δεν βρέθηκε στη συσκευή.");
    const owner=scope;
    const blob=await api("/api/documents/"+item.remoteId,{asBlob:true});
    if(owner!==scope)throw Error("Ο λογαριασμός άλλαξε.");
    // Cache the cloud file so the browser can show it offline next time.
    try{
      const key=item.clientKey||item.remoteId;
      await writeLocal({key:recordKey(key),id:key,scope,blob,cloudId:item.remoteId,
        kind:item.kind,title:item.title,expiry:item.expiry,cost:item.cost,
        fileName:item.fileName,mime:item.mime,size:item.size,createdAt:item.createdAt});
    }catch(error){console.warn("Local document cache unavailable",error);}
    return blob;
  }
  function clearPreview(){
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    $("documentPreviewFrame").removeAttribute("src");
    $("documentPreviewImage").removeAttribute("src");
    $("documentPreviewNewTab").removeAttribute("href");
    $("documentPreviewDownload").removeAttribute("href");
  }
  async function openDocument(item){
    const serial=++previewSerial,owner=scope;
    const dialog=$("documentPreview");
    clearPreview();
    $("documentPreviewTitle").textContent=item.title||NAMES[item.kind]||"Έγγραφο";
    $("documentPreviewStatus").textContent="Άνοιγμα εγγράφου…";
    $("documentPreviewFrame").hidden=true;
    $("documentPreviewImage").hidden=true;
    $("documentPreviewNewTab").hidden=true;
    $("documentPreviewDownload").hidden=true;
    if(!dialog.open)dialog.showModal();
    try{
      const blob=await getBlob(item);
      if(serial!==previewSerial||owner!==scope||!dialog.open)return;
      previewUrl=URL.createObjectURL(blob);
      const target=item.mime==="application/pdf"?
        $("documentPreviewFrame"):$("documentPreviewImage");
      target.src=previewUrl;target.hidden=false;
      $("documentPreviewStatus").textContent="";
      const tab=$("documentPreviewNewTab"),save=$("documentPreviewDownload");
      tab.href=previewUrl;tab.hidden=false;
      save.href=previewUrl;save.download=item.fileName||"έγγραφο";save.hidden=false;
    }catch(error){
      if(serial===previewSerial)$("documentPreviewStatus").textContent=error.message;
    }
  }
  async function downloadDocument(item){
    const owner=scope;
    try{
      const blob=await getBlob(item);
      if(owner!==scope)return;
      const url=URL.createObjectURL(blob),a=element("a");
      a.href=url;a.download=item.fileName||"έγγραφο";
      document.body.appendChild(a);
      try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
    }catch(error){notice("Η λήψη απέτυχε: "+error.message,true);}
  }
  function openKind(kind){
    if(!NAMES[kind])return;
    const doc=merged.find(x=>x.kind===kind);
    if(doc){openDocument(doc);return;}
    const panel=$("documentsPanel");
    panel.open=true;
    $("documentKind").value=kind;
    fillObligationFields();
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }
  window.CarHistoryDocuments={
    hasKind:kind=>merged.some(item=>item.kind===kind),
    openKind,
    refresh:()=>refresh()
  };
  async function migrateOldDocs(pending,owner){
    if(migrating||busy||!pending.length)return;
    migrating=true;
    let succeeded=0,err=null;
    try{
      for(const item of pending){
        if(owner!==scope||busy)return;
        try{
          const cloudId=await upload(item);
          const saved={...item,cloudId};
          await writeLocal(saved);
          window.CarHistoryObligations?.update(item.kind,item.expiry,item.cost,false);
          succeeded++;
        }catch(error){err=error;break;}
      }
    }finally{
      migrating=false;
      if(owner===scope){
        if(err)notice("Τοπικά έγγραφα: η μεταφορά στο cloud εκκρεμεί. "+err.message,true);
        else if(succeeded)notice(succeeded+" παλιότερα έγγραφα αποθηκεύτηκαν στο Cloudflare.");
        // Avoid a retry loop if an upload was rejected or the quota was reached.
        await refresh({skipMigration:true});
      }
    }
  }
  async function refresh({skipMigration=false}={}){
    if(!scope)return;
    const owner=scope,serial=++refreshSerial;
    try{local=await allLocal(owner);}
    catch(error){local=[];console.warn("IndexedDB cache unavailable",error);}
    if(serial!==refreshSerial||owner!==scope)return;
    redraw();
    let available=false;
    try{
      const result=await api("/api/documents");
      if(serial!==refreshSerial||owner!==scope)return;
      cloud=Array.isArray(result.documents)?result.documents:[];
      available=true;cloudReady=true;
    }catch(error){
      if(serial!==refreshSerial||owner!==scope)return;
      cloud=[];cloudReady=false;
      if(local.length)notice("Offline: τα τοπικά έγγραφα είναι διαθέσιμα. "+error.message,true);
      else notice("Cloudflare: "+error.message,true);
    }
    if(serial!==refreshSerial||owner!==scope)return;
    redraw();
    const synced=new Set(cloud.map(item=>item.clientKey));
    const pending=local.filter(item=>!synced.has(item.id)&&!item.cloudId&&item.blob);
    if(available&&!skipMigration&&pending.length&&!migrating&&!busy)
      void migrateOldDocs(pending,owner);
  }
  function fillObligationFields(){
    const kind=$("documentKind").value;
    const info=window.CarHistoryObligations?.get(kind);
    if(!info)return;
    if(!$("documentExpiry").value)$("documentExpiry").value=info.expiry||"";
    if(!$("documentCost").value)$("documentCost").value=info.cost??"";
  }
  $("documentKind").addEventListener("change",()=>{
    $("documentExpiry").value="";$("documentCost").value="";
    fillObligationFields();
  });
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(busy||!scope||document.body.classList.contains("account-locked"))return;
    const file=$("documentFile").files?.[0],mime=file&&safeMime(file);
    const expiry=$("documentExpiry").value,cost=costValue($("documentCost").value);
    if(!mime){notice("Επίλεξε φωτογραφία ή PDF έως 25 MB.",true);return;}
    if(!goodDate(expiry)||cost!==""&&(!Number.isFinite(cost)||cost<0||cost>999999)){
      notice("Έλεγξε την ημερομηνία ή το ποσό.",true);return;
    }
    const owner=scope,kind=$("documentKind").value;
    const id=crypto.randomUUID();
    const record={
      key:recordKey(id),id,scope:owner,kind,title:$("documentTitle").value.trim().slice(0,100),
      expiry,cost,fileName:file.name.split(/[\\/]/).pop().slice(0,160),
      mime,size:file.size,blob:file,createdAt:Date.now()
    };
    busy=true;$("documentSave").disabled=true;
    let cached=false,uploaded=false,cloudId="";
    try{
      try{
        await writeLocal(record);cached=true;
        if(owner===scope)window.CarHistoryObligations?.update(kind,expiry,cost,true);
      }catch(error){console.warn("Cannot cache document on device",error);}
      cloudId=await upload(record);uploaded=true;
      if(cached)try{await writeLocal({...record,cloudId});}catch{}
      if(owner===scope){
        window.CarHistoryObligations?.update(kind,expiry,cost,true);
        form.reset();
        notice("Το έγγραφο αποθηκεύτηκε στο Cloudflare και συνδέθηκε με "+(NAMES[kind]||"την υποχρέωση")+".");
      }
    }catch(error){
      if(owner===scope)
        notice(cached?
          "Το έγγραφο κρατήθηκε τοπικά, αλλά δεν συγχρονίστηκε στο Cloudflare: "+error.message:
          "Δεν αποθηκεύτηκε το έγγραφο: "+error.message,true);
    }finally{
      busy=false;$("documentSave").disabled=false;
      if(owner===scope){
        await refresh({skipMigration:!uploaded});
      }
    }
  });
  $("documentsShortcut")?.addEventListener("click",()=>{
    const panel=$("documentsPanel");
    panel.open=true;
    panel.scrollIntoView({behavior:"smooth",block:"start"});
    fillObligationFields();
  });
  $("documentPreviewClose").addEventListener("click",()=>$("documentPreview").close());
  $("documentPreview").addEventListener("close",()=>{
    previewSerial++;clearPreview();
  });
  async function activate(){
    const next=window.CarHistoryAccountReady?window.CarHistoryAccountScope:"";
    if(!/^[0-9a-f]{64}$/.test(next||""))return;
    if(scope!==next){
      scope=next;cloud=[];local=[];merged=[];cloudReady=false;refreshSerial++;previewSerial++;
      clearPreview();
      if($("documentPreview").open)$("documentPreview").close();
      form.reset();notice("");redraw();
    }
    fillObligationFields();
    await refresh();
  }
  window.addEventListener("carhistory:ready",()=>{void activate();});
  window.addEventListener("online",()=>{if(scope)void refresh();});
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden&&scope)void refresh();
  });
  if(window.CarHistoryAccountReady)void activate();
})();
