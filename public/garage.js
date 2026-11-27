/* Vehicle illustration: local photo processing, synced compact avatar. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const FALLBACK="/garage-car.svg", FOCUS="/car-focus.webp", LIMIT=48000;
function validAvatar(v){return typeof v==="string"&&v.length<=LIMIT&&/^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);}
function automatic(profile){
 const p=profile||{},make=String(p.make||"").toLowerCase(),model=String(p.model||"").toLowerCase(),trim=String(p.trim||"").toLowerCase();
 return /\bford\b/.test(make)&&/\bfocus\b/.test(model)&&Number(p.year)>=2005&&Number(p.year)<=2007&&!/hatchback|sedan|saloon|cabrio|coupe|3θυρο|5θυρο/.test(model+" "+trim)?FOCUS:FALLBACK;
}
function source(profile,avatar){return validAvatar(avatar)?avatar:automatic(profile);}
function setImage(el,src){if(el&&el.getAttribute("src")!==src)el.setAttribute("src",src);}
function render(){
 const hero=$("garageHero");
 if(!hero)return;
 const src=source(settings.vehicleProfile,settings.vehicleAvatar);
 setImage($("garageCar"),src);
 hero.title=validAvatar(settings.vehicleAvatar)?"Η δική σου φωτογραφία · πάτησε για αλλαγή":src===FOCUS?"Ενδεικτική απεικόνιση Focus Mk2 · πάτησε για αλλαγή":"Ενδεικτικό αυτοκίνητο · πάτησε για αλλαγή";
 const state=document.querySelector("#next .service-remaining");
 hero.dataset.state=["service-good","service-warning","service-critical","service-overdue"].find(c=>state?.classList.contains(c))||"unknown";
}
let changed=false,draft="",file=null,serial=0,busy=false;
const field=$("garagePhoto"),remove=$("garageRemove"),cutout=$("garageCutout"),preview=$("garagePreview"),message=$("garagePhotoStatus"),save=$("aiSaveVehicle"),dialog=$("aiVehicleDialog");
if(!field||!remove||!cutout||!preview||!message||!save||!dialog||!$("garageCar"))return;
const outline=$("garageOutline"),outlineOpen=$("garageOutlineOpen"),outlineCanvas=$("garageOutlineCanvas"),outlineApply=$("garageOutlineApply");
let outlineImage=null,points=[];
function hideOutline(){if(outline)outline.hidden=true;outlineImage=null;points=[];if(outlineApply)outlineApply.disabled=true;}
function outlineAvailable(){if(outlineOpen)outlineOpen.hidden=!file&&!validAvatar(changed?draft:settings.vehicleAvatar);}
const formProfile=()=>({make:$("aiCarMake").value,model:$("aiCarModel").value,year:$("aiCarYear").value,trim:$("aiCarTrim").value});
function refreshPreview(){setImage(preview,source(formProfile(),changed?draft:settings.vehicleAvatar));}
function status(text){message.textContent=text;}
function setBusy(value){busy=value;save.disabled=value;}
function open(){
 serial++;changed=false;draft="";file=null;field.value="";cutout.checked=true;hideOutline();setBusy(false);status("");refreshPreview();outlineAvailable();
}
function cancel(){serial++;file=null;draft="";changed=false;hideOutline();setBusy(false);}
function commit(){
 if(busy||!accountIsCurrent())return false;
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
  const canvas=document.createElement("canvas"),ratio=Math.min(1,768/Math.max(im.naturalWidth,im.naturalHeight));
  canvas.width=Math.max(1,Math.round(im.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(im.naturalHeight*ratio));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(im,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),removed=removeBackground&&stripBackground(pixels,canvas.width,canvas.height);
  if(removed)ctx.putImageData(pixels,0,0);
  let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels.data[(y*canvas.width+x)*4+3]>16){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  if(maxX<0)throw Error("Η εικόνα δεν έχει ορατά στοιχεία.");
  const out=document.createElement("canvas"),w=maxX-minX+1,h=maxY-minY+1;
  for(const size of [480,384,320,256,192,128,96]){
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
  draft=result.value;changed=true;refreshPreview();outlineAvailable();
  status(result.removed?"Αφαιρέθηκε το μονόχρωμο φόντο. Έλεγξε την προεπισκόπηση.":cutout.checked?"Για σύνθετο φόντο πάτησε «Περίγραμμα αυτοκινήτου» και κράτησε μόνο το όχημα.":"Η εικόνα είναι έτοιμη.");
 }catch(e){if(ticket===serial){status(e.message||"Η φωτογραφία δεν διαβάστηκε. Δοκίμασε JPG ή PNG.");}}
 finally{if(ticket===serial)setBusy(false);}
}
field.addEventListener("change",()=>{hideOutline();file=field.files?.[0]||null;outlineAvailable();if(file)process();});
cutout.addEventListener("change",()=>{if(file){hideOutline();process();}});
remove.addEventListener("click",()=>{serial++;file=null;field.value="";changed=true;draft="";hideOutline();setBusy(false);refreshPreview();outlineAvailable();status("Θα χρησιμοποιηθεί το αυτόματο εικονίδιο.");});
for(const id of ["aiCarMake","aiCarModel","aiCarYear","aiCarTrim"])$(id).addEventListener("input",refreshPreview);
dialog.addEventListener("close",cancel);
function drawOutline(){
 if(!outlineImage||!outlineCanvas)return;
 const ctx=outlineCanvas.getContext("2d");ctx.clearRect(0,0,outlineCanvas.width,outlineCanvas.height);ctx.drawImage(outlineImage,0,0,outlineCanvas.width,outlineCanvas.height);
 if(points.length){
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  if(points.length>=3){ctx.closePath();ctx.fillStyle="#4ee6cd33";ctx.fill();}
  ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle="#16a7a5";ctx.lineWidth=1.5;ctx.stroke();
  for(const [x,y] of points){ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle="#79f8df";ctx.fill();}
 }
 outlineApply.disabled=points.length<3;
}
outlineOpen?.addEventListener("click",async()=>{
 if(!outline||!outlineCanvas||busy)return;
 const saved=changed?draft:settings.vehicleAvatar;
 if(!file&&!validAvatar(saved))return;
 if(file&&(file.size>15*1024*1024||!/^image\/(?:jpeg|png|webp|heic|heif|avif)$/i.test(file.type||""))){status("Επίλεξε φωτογραφία JPG, PNG ή WebP έως 15 MB.");return;}
 const ticket=++serial,scope=window.CarHistoryAccountScope;
 let url;setBusy(true);hideOutline();status("Άνοιγμα φωτογραφίας…");
 try{
  url=file?URL.createObjectURL(file):saved;
  const im=new Image();im.src=url;await im.decode();
  if(ticket!==serial||!dialog.open||scope!==window.CarHistoryAccountScope||!accountIsCurrent())return;
  const ratio=Math.min(1,720/Math.max(im.naturalWidth,im.naturalHeight));
  outlineCanvas.width=Math.max(1,Math.round(im.naturalWidth*ratio));
  outlineCanvas.height=Math.max(1,Math.round(im.naturalHeight*ratio));
  outlineImage=im;points=[];outline.hidden=false;drawOutline();status("Σχεδίασε το περίγραμμα. Μπορείς να αναιρέσεις σημεία.");
 }catch(e){if(ticket===serial){hideOutline();setBusy(false);status("Δεν άνοιξε η φωτογραφία. Δοκίμασε άλλη.");}}
 finally{if(url&&url.startsWith("blob:"))URL.revokeObjectURL(url);if(ticket===serial&&!outlineImage)setBusy(false);}
});
outlineCanvas?.addEventListener("click",e=>{
 if(!outlineImage||points.length>=180)return;
 const r=outlineCanvas.getBoundingClientRect();
 const x=(e.clientX-r.left)*outlineCanvas.width/r.width,y=(e.clientY-r.top)*outlineCanvas.height/r.height;
 points.push([Math.max(0,Math.min(outlineCanvas.width,x)),Math.max(0,Math.min(outlineCanvas.height,y))]);drawOutline();
});
$("garageOutlineUndo")?.addEventListener("click",()=>{points.pop();drawOutline();});
$("garageOutlineCancel")?.addEventListener("click",()=>{++serial;hideOutline();setBusy(false);status("Η προηγούμενη προεπισκόπηση διατηρήθηκε.");});
outlineApply?.addEventListener("click",()=>{
 if(!outlineImage||points.length<3||!accountIsCurrent()||!dialog.open)return;
 try{
  const c=document.createElement("canvas");c.width=outlineCanvas.width;c.height=outlineCanvas.height;
  const ctx=c.getContext("2d");ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();ctx.drawImage(outlineImage,0,0,c.width,c.height);
  const x=Math.floor(Math.min(...points.map(p=>p[0]))),y=Math.floor(Math.min(...points.map(p=>p[1]))),w=Math.ceil(Math.max(...points.map(p=>p[0])))-x,h=Math.ceil(Math.max(...points.map(p=>p[1])))-y;
  if(w<8||h<8)throw Error("Επίλεξε μεγαλύτερο περίγραμμα.");
  const out=document.createElement("canvas");let encoded="";
  for(const size of [480,384,320,256,192,128,96]){
   const scale=Math.min(1,size/Math.max(w,h));out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));
   out.getContext("2d").drawImage(c,x,y,w,h,0,0,out.width,out.height);
   const v=out.toDataURL("image/webp",.82);if(validAvatar(v)){encoded=v;break;}
  }
  if(!encoded)throw Error("Η εικόνα δεν χωράει. Δοκίμασε μικρότερη επιλογή.");
  draft=encoded;changed=true;hideOutline();setBusy(false);refreshPreview();outlineAvailable();status("Το περίγραμμα είναι έτοιμο. Πάτησε Αποθήκευση.");
 }catch(e){status(e.message||"Η επιλογή δεν ολοκληρώθηκε.");}
});
$("garageCar").addEventListener("load",()=>{
 const img=$("garageCar"),hero=$("garageHero");
 try{
  if(!validAvatar(img.getAttribute("src"))){delete hero.dataset.photo;return;}
  const c=document.createElement("canvas");c.width=24;c.height=24;
  const ctx=c.getContext("2d");ctx.drawImage(img,0,0,24,24);
  const pixels=ctx.getImageData(0,0,24,24).data;let transparent=0;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]<32)transparent++;
  hero.dataset.photo=transparent>30?"cutout":"rect";
 }catch{hero.dataset.photo="rect";}
});
$("garageCar").addEventListener("error",()=>{if($("garageCar").getAttribute("src")!==FALLBACK)setImage($("garageCar"),FALLBACK);});
preview.addEventListener("error",()=>{if(preview.getAttribute("src")!==FALLBACK)setImage(preview,FALLBACK);});
window.CarGarage={render,open,commit,automatic,validAvatar};
})();
