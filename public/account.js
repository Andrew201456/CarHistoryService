/* Username/password login. The only persistent credential on the client is
   an expiring account session. Passwords and master admin secret are NEVER
   stored in localStorage or delivered to the application after login. */
(function(){
  "use strict";
  const ACTIVE="carServiceActiveAccountV3";
  const $=id=>document.getElementById(id);
  const gate=$("accountGate"),message=$("accountMessage");
  if(!gate)return;
  const login=$("accountLoginForm"),loginBtn=$("accountLoginBtn"),
    loginText=$("accountLoginBtnText"),usernameEl=$("accountUsername"),
    passwordEl=$("accountPassword"),
    loginPanel=$("accountLoginPanel"),registerPanel=$("accountRegisterPanel"),
    registerBtn=$("accountCustomCreate"),backBtn=$("accountBackToLogin"),
    openBtn=$("accountOpenRegister");
  const SCOPE=/^[a-f0-9]{64}$/,SESSION=/^ST-[a-f0-9]{64}-[A-F0-9]{48}$/,
    NAME=/^[A-Z][A-Z0-9._-]{1,31}$/;
  let current=null,busy=false,requestSerial=0,autoAbort=null;
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
  function start(info){
    if(!valid(info))throw Error("Ο διακομιστής επέστρεψε μη έγκυρη σύνδεση.");
    current={username:info.username,scope:info.scope,session:info.session};
    // Do not persist password or master admin, including for legacy accounts.
    localStorage.setItem(ACTIVE,JSON.stringify(current));
    passwordEl.value="";
    $("accountLoginMaster").value="";
    $("accountLoginMasterWrap").hidden=true;
    gate.hidden=true;
    document.body.classList.remove("account-locked");
    window.CarAppStartAccount(current.session,current.scope);
  }
  function cancelRestore(){
    requestSerial++;
    autoAbort?.abort();autoAbort=null;
  }
  async function credentialsLogin(username,password,{auto=false,expectedScope=null}={}){
    const canonical=normalizedUser(username);
    if(!NAME.test(canonical)||!validPassword(password))
      throw Error("Συμπλήρωσε σωστά username και password.");
    const serial=++requestSerial;
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem(ACTIVE)||"null");}catch{}
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
    cancelRestore();usernameEl.removeAttribute("aria-invalid");
    $("accountLoginMasterWrap").hidden=true;
    $("accountLoginMaster").value="";
  });
  passwordEl.addEventListener("input",()=>{
    cancelRestore();passwordEl.removeAttribute("aria-invalid");
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
      alert("Συγχρόνισε τις αλλαγές ή κράτησε αντίγραφο πριν αποσυνδεθείς.");
      return;
    }
    if(!confirm("Αποσύνδεση; Τα δεδομένα του Cloudflare δεν θα διαγραφούν."))return;
    const keys=["carServiceLog","carServiceSettings","carServiceReminders",
      "carServiceSyncBaseV2","carServiceSyncPendingV2","carServicePass",
      "carServiceDraftV1","carServiceAiConversationV1"];
    for(const key of keys)localStorage.removeItem(key+":"+current.scope);
    localStorage.removeItem(ACTIVE);
    location.reload();
  }
  window.CarAccountLogout=logout;
  window.CarAccountLock=()=>{
    localStorage.removeItem(ACTIVE);location.reload();
  };
  window.CarAccountShowCode=async()=>{
    if(!current)return;
    const username=current.username;
    try{
      await navigator.clipboard.writeText(username);
      $("bkmsg").textContent="Το username αντιγράφηκε.";
    }catch{prompt("Username:",username);}
  };
  $("accountPasswordForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!current||busy)return;
    const status=$("accountPasswordStatus"),currentPassword=$("accountCurrentPassword").value,
      newPassword=$("accountNewPassword").value;
    if(!validPassword(currentPassword)||!validPassword(newPassword)){
      status.textContent="Συμπλήρωσε και τους δύο κωδικούς (τουλάχιστον 4 χαρακτήρες).";
      return;
    }
    if(pendingSync()){
      status.textContent="Πρώτα συγχρόνισε τις εκκρεμείς αλλαγές.";
      return;
    }
    busy=true;$("accountChangePassword").disabled=true;
    status.textContent="Αλλαγή password…";
    try{
      const result=await api("/api/account/password",{
        username:current.username,currentPassword,newPassword
      },current.session);
      if(result.scope!==current.scope)throw Error("Ασυμφωνία λογαριασμού.");
      localStorage.setItem(ACTIVE,JSON.stringify({
        username:current.username,scope:current.scope,session:result.session
      }));
      $("accountCurrentPassword").value="";
      $("accountNewPassword").value="";
      location.reload();
    }catch(error){status.textContent=error.message||"Η αλλαγή απέτυχε.";}
    finally{busy=false;$("accountChangePassword").disabled=false;}
  });
  // Existing optional migration of the very old, shared PASSCODE dataset
  // stays available for users who still require it.
  $("legacyTransfer")?.addEventListener("click",async()=>{
    if(!current||busy)return;
    const legacyCode=$("legacyAccountCode").value.trim();
    if(!legacyCode){$("legacyStatus").textContent="Συμπλήρωσε τον παλιό κωδικό.";return;}
    if(!confirm("Μεταφορά πολύ παλιού ιστορικού σε άδειο λογαριασμό;"))return;
    busy=true;$("legacyTransfer").disabled=true;
    try{
      await api("/api/account/migrate",{legacyCode},current.session);
      window.CarAppCopyLegacyLocal();
      $("legacyAccountCode").value="";
      $("legacyStatus").textContent="Η μεταφορά ολοκληρώθηκε. Επαναφόρτωση…";
      location.reload();
    }catch(error){$("legacyStatus").textContent=error.message;}
    finally{busy=false;$("legacyTransfer").disabled=false;}
  });
  window.addEventListener("storage",event=>{
    if(event.key!==ACTIVE||!current)return;
    try{
      const now=JSON.parse(event.newValue||"null");
      if(now?.scope!==current.scope)location.reload();
    }catch{location.reload();}
  });
  // Restore a valid session without the old password. Previous PIN-based
  // local sessions can migrate automatically only if they belong to one of
  // the explicitly mapped historical scopes.
  let last=null;
  try{last=JSON.parse(localStorage.getItem(ACTIVE)||"null");}catch{}
  if(valid(last)){
    usernameEl.value=last.username;
    const serial=++requestSerial,abort=new AbortController();
    autoAbort=abort;
    notice("Επανασύνδεση…");
    api("/api/account/session",{},last.session,{signal:abort.signal,timeoutMs:8000})
      .then(result=>{
        if(serial===requestSerial&&result.scope===last.scope)start(last);
      }).catch(error=>{
        if(serial!==requestSerial||error.cancelled)return;
        notice(error.status===401?
          "Η σύνδεση έληξε. Βάλε το password σου.":
          error.message,true);
      }).finally(()=>{if(autoAbort===abort)autoAbort=null;});
  }else if(last?.code){
    // Prior app versions kept the PIN locally. Never expose or auto-send it
    // from a publicly served JavaScript mapping. The user signs in with
    // their new username/password and the server links to their old history.
    notice("Συνδέσου με το νέο username και password. Το παλιό ιστορικό παραμένει στον λογαριασμό σου.");
  }
})();