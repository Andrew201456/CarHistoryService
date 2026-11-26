/* Username/password login. The only persistent credential on the client is
   an expiring account session. Passwords and master admin secret are NEVER
   stored in localStorage or delivered to the application after login. */
(function(){
  "use strict";
  const ACTIVE="carServiceActiveAccountV3";
  const REMEMBER="carServiceRememberMeV1";
  const $=id=>document.getElementById(id);
  const gate=$("accountGate"),message=$("accountMessage");
  if(!gate)return;
  const login=$("accountLoginForm"),loginBtn=$("accountLoginBtn"),
    loginText=$("accountLoginBtnText"),usernameEl=$("accountUsername"),
    passwordEl=$("accountPassword"),rememberEl=$("accountRememberMe"),
    loginPanel=$("accountLoginPanel"),registerPanel=$("accountRegisterPanel"),
    registerBtn=$("accountCustomCreate"),backBtn=$("accountBackToLogin"),
    openBtn=$("accountOpenRegister");
  const SCOPE=/^[a-f0-9]{64}$/,SESSION=/^ST-[a-f0-9]{64}-[A-F0-9]{48}$/,
    NAME=/^[A-Z][A-Z0-9._-]{1,31}$/;
  let current=null,busy=false,requestSerial=0,autoAbort=null,restoreCandidate=null,checkingLock=false;
  const retryPanel=$("accountSessionRetry");
  function clearSavedSession(){
    for(const remember of [false,true]){
      try{const storage=remember?localStorage:sessionStorage;storage.removeItem(ACTIVE);storage.removeItem(REMEMBER);}catch{}
    }
  }
  function showRetry(visible){
    if(retryPanel)retryPanel.hidden=!visible;
    login.hidden=visible;
    openBtn.hidden=visible;
  }
  const normalizedUser=value=>String(value||"").trim().normalize("NFKC").toUpperCase();
  const validPassword=value=>typeof value==="string"&&[...value].length>=4&&
    [...value].length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
  function valid(a){
    return !!a&&NAME.test(a.username||"")&&SCOPE.test(a.scope||"")&&
      SESSION.test(a.session||"");
  }
  function notice(text,error=false){
    message.textContent=text||"";
    message.classList.toggle("error",error);
  }
  function setBusy(value){
    busy=value;
    for(const el of [loginBtn,registerBtn,openBtn,backBtn])el.disabled=value;
    loginBtn.setAttribute("aria-busy",String(value));
    login.setAttribute("aria-busy",String(value));
    loginText.textContent=value?"Σύνδεση…":"Σύνδεση";
  }
  async function api(path,body={},authorization="",options={}){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    options.signal?.addEventListener("abort",abort,{once:true});
    if(options.signal?.aborted)controller.abort();
    const timer=setTimeout(()=>controller.abort(),options.timeoutMs||15000);
    try{
      const r=await fetch(path,{
        method:"POST",cache:"no-store",credentials:"same-origin",signal:controller.signal,
        headers:{"Content-Type":"application/json",
          ...(authorization?{"Authorization":"Bearer "+authorization}:{})},
        body:JSON.stringify(body)
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok){
        const error=new Error(data.error||"Σφάλμα σύνδεσης ("+r.status+").");
        error.status=r.status;
        error.masterRequired=!!data.masterRequired;
        error.masterError=typeof data.masterError==="string"?data.masterError:"";
        throw error;
      }
      return data;
    }catch(error){
      if(controller.signal.aborted){
        if(options.signal?.aborted)throw Object.assign(new Error("Ακυρώθηκε."),{cancelled:true});
        throw new Error("Η σύνδεση καθυστέρησε. Έλεγξε το ίντερνετ.");
      }
      if(error instanceof TypeError)throw new Error("Δεν υπάρχει σύνδεση με το Cloudflare.");
      throw error;
    }finally{
      clearTimeout(timer);
      options.signal?.removeEventListener("abort",abort);
    }
  }
  function savedSession(){
    // Older installations stored the session in localStorage unconditionally.
    // Keep them usable without losing any historical entries.
    for(const remember of [false,true]){
      try{
        const storage=remember?localStorage:sessionStorage;
        const value=JSON.parse(storage.getItem(ACTIVE)||"null");
        if(valid(value))return {value,remember};
        if(remember&&value?.code)return {value,remember:true,legacy:true};
      }catch{}
    }
    return null;
  }
  function persistSession(info,remember){
    // Store only the expiring server-issued session, never a password.
    const serialized=JSON.stringify(info);
    if(remember){
      try{
        localStorage.setItem(ACTIVE,serialized);
        if(localStorage.getItem(ACTIVE)!==serialized)throw Error("Storage unavailable");
        try{localStorage.setItem(REMEMBER,"1");}catch{}
        try{sessionStorage.removeItem(ACTIVE);}catch{}
        return true;
      }catch{
        sessionStorage.setItem(ACTIVE,serialized);
        return false;
      }
    }
    sessionStorage.setItem(ACTIVE,serialized);
    try{localStorage.removeItem(ACTIVE);localStorage.removeItem(REMEMBER);}catch{}
    return false;
  }
  function start(info,{remember=rememberEl.checked}={}){
    if(!valid(info))throw Error("Ο διακομιστής επέστρεψε μη έγκυρη σύνδεση.");
    const next={username:info.username,scope:info.scope,session:info.session};
    const persisted=persistSession(next,remember);
    current=next;
    rememberEl.checked=persisted;
    restoreCandidate=null;
    showRetry(false);
    // Do not persist password or master admin, including for legacy accounts.
    passwordEl.value="";
    $("accountLoginMaster").value="";
    $("accountLoginMasterWrap").hidden=true;
    gate.hidden=true;
    document.documentElement.classList.remove("account-restoring");
    document.body.classList.remove("account-locked");
    window.CarAppStartAccount(current.session,current.scope);
    if(remember&&!persisted)alert("Ο browser δεν επιτρέπει μόνιμη αποθήκευση της σύνδεσης. Θα παραμείνεις συνδεδεμένος σε αυτή την καρτέλα.");
  }
  function cancelRestore(){
    requestSerial++;
    autoAbort?.abort();autoAbort=null;
    document.documentElement.classList.remove("account-restoring");
  }
  async function credentialsLogin(username,password,{auto=false,expectedScope=null}={}){
    const canonical=normalizedUser(username);
    if(!NAME.test(canonical)||!validPassword(password))
      throw Error("Συμπλήρωσε σωστά username και password.");
    const serial=++requestSerial;
    const saved=savedSession()?.value;
    const legacySession=saved?.code&&SESSION.test(saved.session||"")?saved.session:"";
    const masterField=$("accountLoginMasterWrap");
    const masterAdmin=masterField&&!masterField.hidden?
      $("accountLoginMaster").value:"";
    const result=await api("/api/account/login",{
      username:canonical,password,
      ...(legacySession?{legacySession}:{}),
      ...(masterAdmin?{masterAdmin}:{})
    },"",{timeoutMs:auto?12000:18000});
    if(masterAdmin)$("accountLoginMaster").value="";
    masterField.hidden=true;
    if(serial!==requestSerial)return;
    if(expectedScope&&result.scope!==expectedScope)
      throw Error("Το νέο username δεν αντιστοιχεί στο παλιό ιστορικό. Η σύνδεση ακυρώθηκε.");
    start({username:canonical,scope:result.scope,session:result.session});
  }
  login.addEventListener("submit",async event=>{
    event.preventDefault();
    if(busy)return;
    cancelRestore();
    setBusy(true);
    notice("Σύνδεση…");
    usernameEl.removeAttribute("aria-invalid");
    passwordEl.removeAttribute("aria-invalid");
    try{
      await credentialsLogin(usernameEl.value,passwordEl.value);
      if(current)notice("");
    }catch(error){
      if(error.masterRequired){
        $("accountLoginMasterWrap").hidden=false;
        // A wrongly entered master must not linger in a password field.
        if(error.masterError==="mismatch")$("accountLoginMaster").value="";
        if(error.masterError!=="configuration")$("accountLoginMaster").focus();
        notice(error.message||"Συμπλήρωσε τον master admin κωδικό για την πρώτη ενεργοποίηση.",true);
      }else{
        usernameEl.setAttribute("aria-invalid","true");
        passwordEl.setAttribute("aria-invalid","true");
        notice(error.message||"Η σύνδεση απέτυχε.",true);
      }
    }finally{setBusy(false);}
  });
  usernameEl.addEventListener("input",()=>{
    usernameEl.removeAttribute("aria-invalid");
    $("accountLoginMasterWrap").hidden=true;
    $("accountLoginMaster").value="";
  });
  passwordEl.addEventListener("input",()=>{
    passwordEl.removeAttribute("aria-invalid");
  });
  function showRegister(yes){
    if(busy)return;
    loginPanel.hidden=yes;
    registerPanel.hidden=!yes;
    openBtn.hidden=yes;
    openBtn.setAttribute("aria-expanded",String(yes));
    notice("");
    if(yes)$("accountCustomUsername").focus();else usernameEl.focus();
  }
  openBtn.addEventListener("click",()=>{cancelRestore();showRegister(true);});
  backBtn.addEventListener("click",()=>showRegister(false));
  $("accountCustomForm").addEventListener("submit",async event=>{
    event.preventDefault();
    if(busy)return;
    const username=normalizedUser($("accountCustomUsername").value),
      password=$("accountCustomPassword").value,
      masterAdmin=$("accountMasterAdmin").value;
    if(!NAME.test(username)||!validPassword(password)||!masterAdmin){
      notice("Συμπλήρωσε username, password και master admin κωδικό.",true);return;
    }
    setBusy(true);notice("Δημιουργία λογαριασμού…");
    try{
      const result=await api("/api/account/create",{username,password,masterAdmin});
      $("accountMasterAdmin").value="";
      $("accountCustomPassword").value="";
      start({username,scope:result.scope,session:result.session});
    }catch(error){
      $("accountMasterAdmin").value="";
      notice(error.message||"Δεν δημιουργήθηκε ο λογαριασμός.",true);
    }finally{setBusy(false);}
  });
  function pendingSync(){
    return current&&localStorage.getItem("carServiceSyncPendingV2:"+current.scope)==="1";
  }
  function logout(){
    if(!current)return;
    if(pendingSync()){
      notice("Έχεις αλλαγές που δεν συγχρονίστηκαν ακόμη.",true);
      alert("Περίμενε να συγχρονιστούν οι αλλαγές πριν αποσυνδεθείς. Αν δεν ολοκληρώνεται ο συγχρονισμός, επικοινώνησε με τον διαχειριστή.");
      return;
    }
    if(!confirm("Αποσύνδεση; Τα δεδομένα του Cloudflare δεν θα διαγραφούν."))return;
    const keys=["carServiceLog","carServiceSettings","carServiceReminders",
      "carServiceSyncBaseV2","carServiceSyncPendingV2","carServicePass",
      "carServiceDraftV1","carServiceAiConversationV1"];
    for(const key of keys)localStorage.removeItem(key+":"+current.scope);
    localStorage.removeItem(ACTIVE);
    localStorage.removeItem(REMEMBER);
    try{sessionStorage.removeItem(ACTIVE);}catch{}
    location.reload();
  }
  window.CarAccountLogout=logout;
  window.CarAccountLock=async()=>{
    if(!current||checkingLock)return;
    checkingLock=true;
    const candidate=current;
    try{
      const result=await api("/api/account/session",{},candidate.session,{timeoutMs:15000});
      if(result.scope!==candidate.scope)throw Error("Ασυμφωνία λογαριασμού.");
      window.setSt?.("Προσωρινό πρόβλημα σύνδεσης · η συνεδρία παραμένει ενεργή.",true);
    }catch(error){
      if(current!==candidate)return;
      if(error.status===401){
        const saved=savedSession();
        if(saved&&saved.value.session!==candidate.session){location.reload();return;}
        clearSavedSession();
        location.reload();
      }else window.setSt?.("Προσωρινή αδυναμία επιβεβαίωσης. Δεν έγινε αποσύνδεση.",true);
    }finally{checkingLock=false;}
  };
  window.addEventListener("storage",event=>{
    if(event.key!==ACTIVE||!current)return;
    try{
      const now=JSON.parse(event.newValue||"null");
      if(now?.scope!==current.scope)location.reload();
    }catch{location.reload();}
  });
  // Restore the server-issued session after refresh; network failures are not logout.
  async function restoreSession(saved){
    if(!saved||!valid(saved.value)||current||autoAbort||busy)return;
    const last=saved.value;
    restoreCandidate=saved;
    rememberEl.checked=saved.remember;
    usernameEl.value=last.username;
    const serial=++requestSerial,abort=new AbortController();
    autoAbort=abort;
    showRetry(true);
    document.documentElement.classList.add("account-restoring");
    notice("");
    let error;
    try{
      for(let attempt=0;attempt<2;attempt++){
        try{
          const result=await api("/api/account/session",{},last.session,{signal:abort.signal,timeoutMs:15000});
          if(serial!==requestSerial||abort.signal.aborted)return;
          if(result.scope!==last.scope)throw Error("Ασυμφωνία λογαριασμού.");
          start(last,{remember:saved.remember});
          notice("");
          return;
        }catch(e){
          if(serial!==requestSerial||e.cancelled||abort.signal.aborted)return;
          error=e;
          if(e.status===401||navigator.onLine===false)break;
        }
      }
      if(error?.status===401){
        const latest=savedSession();
        if(latest&&valid(latest.value)&&latest.value.session!==last.session){
          restoreCandidate=latest;
          notice("Βρέθηκε νεότερη σύνδεση. Πάτησε επανάληψη.",true);
          return;
        }
        clearSavedSession();
        restoreCandidate=null;
        showRetry(false);
        notice("Η συνεδρία έληξε. Συνδέσου ξανά με το password σου.",true);
      }else notice("Η σύνδεσή σου παραμένει αποθηκευμένη. Ο έλεγχος στο Cloudflare δεν ήταν διαθέσιμος. Δοκίμασε ξανά όταν υπάρχει σύνδεση.",true);
    }finally{
      if(autoAbort===abort){autoAbort=null;document.documentElement.classList.remove("account-restoring");}
    }
  }
  $("accountRetrySession")?.addEventListener("click",()=>restoreSession(restoreCandidate||savedSession()));
  $("accountUsePassword")?.addEventListener("click",()=>{
    cancelRestore();restoreCandidate=null;showRetry(false);notice("");passwordEl.focus();
  });
  window.addEventListener("online",()=>{if(!current&&restoreCandidate)restoreSession(restoreCandidate)});
  window.addEventListener("pageshow",event=>{if(event.persisted&&!current&&restoreCandidate)restoreSession(restoreCandidate)});
  const saved=savedSession();
  if(valid(saved?.value))restoreSession(saved);
  else if(saved?.legacy){
    document.documentElement.classList.remove("account-restoring");
    notice("Συνδέσου με το νέο username και password. Το παλιό ιστορικό παραμένει στον λογαριασμό σου.");
  }else document.documentElement.classList.remove("account-restoring");
})();