/* Vehicle illustration: local photo processing, synced compact avatar. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const FALLBACK="/garage-car.svg", FOCUS="/focus-estate.svg", LIMIT=48000;
function validAvatar(v){return typeof v==="string"&&v.length<=LIMIT&&/^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);}
function automatic(profile){
 const p=profile||{},make=String(p.make||"").toLowerCase(),model=String(p.model||"").toLowerCase(),trim=String(p.trim||"").toLowerCase();
 return /\bford\b/.test(make)&&/\bfocus\b/.test(model)&&Number(p.year)>=2005&&Number(p.year)<=2007&&/wagon|estate|station|combi|touring|στέισον|σταισιον/.test(model+" "+trim)?FOCUS:FALLBACK;
}
function source(profile,avatar){return validAvatar(avatar)?avatar:automatic(profile);}
function setImage(el,src){if(el&&el.getAttribute("src")!==src)el.setAttribute("src",src);}
function render(){
 const hero=$("garageHero");
 if(!hero)return;
 setImage($("garageCar"),source(settings.vehicleProfile,settings.vehicleAvatar));
 const state=document.querySelector("#next .service-remaining");
 hero.dataset.state=["service-good","service-warning","service-critical","service-overdue"].find(c=>state?.classList.contains(c))||"unknown";
}
let changed=false,draft="",file=null,serial=0,busy=false;
const field=$("garagePhoto"),remove=$("garageRemove"),cutout=$("garageCutout"),preview=$("garagePreview"),message=$("garagePhotoStatus"),save=$("aiSaveVehicle"),dialog=$("aiVehicleDialog");
const formProfile=()=>({make:$("aiCarMake").value,model:$("aiCarModel").value,year:$("aiCarYear").value,trim:$("aiCarTrim").value});
function refreshPreview(){setImage(preview,source(formProfile(),changed?draft:settings.vehicleAvatar));}
function status(text){message.textContent=text;}
function setBusy(value){busy=value;save.disabled=value;}
function open(){
 serial++;changed=false;draft="";file=null;field.value="";cutout.checked=true;setBusy(false);status("");refreshPreview();
}
function cancel(){serial++;file=null;draft="";changed=false;setBusy(false);}
function commit(){
 if(busy)return false;
 if(changed){if(validAvatar(draft))settings.vehicleAvatar=draft;else delete settings.vehicleAvatar;}
 return true;
}
// Only remove uniform, edge-connected pixels. Never treat a complex scene as a guaranteed cutout.
function stripBackground(data,w,h){
 const d=data.data, corners=[0,w-1,(h-1)*w,w*h-1].map(i=>Array.from(d.subarray(i*4,i*4+4)));
 if(corners.some(c=>c[3]<240))return false;
 const color=corners[0],distance=(r,g,b)=>Math.hypot(r-color[0],g-color[1],b-color[2]);
 if(corners.some(c=>distance(c[0],c[1],c[2])>30))return false;
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 function add(i){if(seen[i])return;seen[i]=1;const j=i*4;if(d[j+3]&&distance(d[j],d[j+1],d[j+2])<=35)queue[tail++]=i;}
 for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
 for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
 while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);if(x>0)add(i-1);if(x<w-1)add(i+1);if(y>0)add(i-w);if(y<h-1)add(i+w);}
 if(tail<Math.max(4,w*h*.01)||tail>w*h*.9)return false;
 for(let i=0;i<tail;i++)d[queue[i]*4+3]=0;
 return true;
}
async function convert(imageFile,removeBackground){
 if(!imageFile||imageFile.size>15*1024*1024||!/^image\/(?:jpeg|png|webp|heic|heif|avif)$/i.test(imageFile.type))throw Error("Επίλεξε φωτογραφία JPG, PNG ή WebP έως 15 MB.");
 const url=URL.createObjectURL(imageFile);
 try{
  const im=new Image();im.src=url;await im.decode();
  if(!im.naturalWidth||!im.naturalHeight)throw Error("Δεν διαβάστηκε η φωτογραφία.");
  const canvas=document.createElement("canvas"),ratio=Math.min(1,384/Math.max(im.naturalWidth,im.naturalHeight));
  canvas.width=Math.max(1,Math.round(im.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(im.naturalHeight*ratio));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(im,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),removed=removeBackground&&stripBackground(pixels,canvas.width,canvas.height);
  if(removed)ctx.putImageData(pixels,0,0);
  let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels.data[(y*canvas.width+x)*4+3]>16){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  if(maxX<0)throw Error("Η εικόνα δεν έχει ορατά στοιχεία.");
  const out=document.createElement("canvas"),w=maxX-minX+1,h=maxY-minY+1;
  for(const size of [320,256,192,128,96]){
   const scale=Math.min(1,size/Math.max(w,h));out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));
   out.getContext("2d").drawImage(canvas,minX,minY,w,h,0,0,out.width,out.height);
   const v=out.toDataURL("image/webp",.75);
   if(validAvatar(v))return {value:v,removed};
  }
  throw Error("Η εικόνα είναι πολύ μεγάλη. Δοκίμασε άλλη φωτογραφία.");
 }finally{URL.revokeObjectURL(url);}
}
async function process(){
 if(!file)return;
 const ticket=++serial,scope=window.CarHistoryAccountScope;setBusy(true);status("Ετοιμάζουμε το εικονίδιο…");
 try{
  const result=await convert(file,cutout.checked);
  if(ticket!==serial||!dialog.open||scope!==window.CarHistoryAccountScope||!accountIsCurrent())return;
  draft=result.value;changed=true;refreshPreview();
  status(result.removed?"Αφαιρέθηκε το μονόχρωμο φόντο. Έλεγξε την προεπισκόπηση.":cutout.checked?"Έτοιμο. Αν το φόντο είναι σύνθετο, διατηρείται.":"Η εικόνα είναι έτοιμη.");
 }catch(e){if(ticket===serial){status(e.message||"Η φωτογραφία δεν διαβάστηκε. Δοκίμασε JPG ή PNG.");}}
 finally{if(ticket===serial)setBusy(false);}
}
field.addEventListener("change",()=>{file=field.files?.[0]||null;if(file)process();});
cutout.addEventListener("change",()=>{if(file)process();});
remove.addEventListener("click",()=>{serial++;file=null;field.value="";changed=true;draft="";setBusy(false);refreshPreview();status("Θα χρησιμοποιηθεί το αυτόματο εικονίδιο.");});
for(const id of ["aiCarMake","aiCarModel","aiCarYear","aiCarTrim"])$(id).addEventListener("input",refreshPreview);
dialog.addEventListener("close",cancel);
$("garageCar").addEventListener("error",()=>{if($("garageCar").getAttribute("src")!==FALLBACK)setImage($("garageCar"),FALLBACK);});
preview.addEventListener("error",()=>{if(preview.getAttribute("src")!==FALLBACK)setImage(preview,FALLBACK);});
window.CarGarage={render,open,commit,automatic,validAvatar};
})();
