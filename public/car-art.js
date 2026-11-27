/* Vehicle art: local illustration selection and bounded, private image preparation. */
(function(){
"use strict";
const LIMIT=90000;
const generic="/car-generic.svg",focus="/car-focus.webp";
function valid(value){return typeof value==="string"&&value.length<=LIMIT&&/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)}
function select(profile,image){
 if(valid(image))return {src:image,kind:"custom"};
 const make=String(profile?.make||"").trim().toLowerCase(),model=String(profile?.model||"").toLowerCase(),year=Number(profile?.year);
 const focusMatch=/^ford$/.test(make)&&/\bfocus\b/.test(model)&&year>=2004&&year<=2007;
 return {src:focusMatch?focus:generic,kind:focusMatch?"focus":"generic"};
}
function render(profile,image){
 const art=select(profile,image),img=document.getElementById("garageCarImage"),label=document.getElementById("garageArtLabel");
 if(!img)return;
 if(img.getAttribute("src")!==art.src)img.src=art.src;
 if(label)label.textContent=art.kind==="custom"?"Το δικό σου αυτοκίνητο":art.kind==="focus"?"Ενδεικτικό Focus Mk2":"Ενδεικτική απεικόνιση";
}
function removeFlatBackground(image){
 const {width:w,height:h,data:d}=image;
 const n=w*h;
 // Existing transparency is retained. Only nearly uniform opaque borders
 // qualify for automatic cutout; complex scenes are intentionally untouched.
 for(let i=3;i<d.length;i+=4)if(d[i]<245)return "transparent";
 const samples=[];
 for(let i=0;i<8;i++){const x=Math.round(i*(w-1)/7),y=Math.round(i*(h-1)/7);samples.push(x,(h-1)*w+x,y*w,y*w+w-1)}
 const ref=[0,1,2].map(c=>Math.round(samples.reduce((sum,p)=>sum+d[p*4+c],0)/samples.length));
 const distance=p=>Math.max(...ref.map((v,c)=>Math.abs(v-d[p*4+c])));
 if(samples.filter(p=>distance(p)<=30).length<samples.length*.85)return "complex";
 const seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
 function add(p){if(!seen[p]&&distance(p)<=38){seen[p]=1;queue[tail++]=p}}
 for(let x=0;x<w;x++){add(x);add((h-1)*w+x)}
 for(let y=0;y<h;y++){add(y*w);add(y*w+w-1)}
 while(head<tail){const p=queue[head++],x=p%w;if(x>0)add(p-1);if(x<w-1)add(p+1);if(p>=w)add(p-w);if(p<n-w)add(p+w)}
 if(tail<n*.05||tail>n*.88)return "complex";
 for(let i=0;i<tail;i++)d[queue[i]*4+3]=0;
 return "removed";
}
async function prepare(file,cutout=true){
 if(!file||file.size>15*1024*1024||!/^image\/(?:jpeg|png|webp|heic|heif|avif)$/i.test(file.type||""))throw Error("Επίλεξε φωτογραφία JPG, PNG ή WebP έως 15 MB.");
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;
  await new Promise((ok,fail)=>{img.onload=ok;img.onerror=()=>fail(Error("Η φωτογραφία δεν ανοίγει. Δοκίμασε JPG ή PNG."));if(img.complete&&img.naturalWidth)ok()});
  if(!img.naturalWidth||!img.naturalHeight)throw Error("Μη έγκυρη φωτογραφία.");
  const canvas=document.createElement("canvas"),ratio=Math.min(1,420/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw Error("Η επεξεργασία εικόνας δεν υποστηρίζεται.");
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),state=cutout?removeFlatBackground(pixels):"original";
  if(state==="removed")ctx.putImageData(pixels,0,0);
  let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels.data[(y*canvas.width+x)*4+3]>16){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  if(maxX<0)throw Error("Η εικόνα είναι κενή.");
  const cw=maxX-minX+1,ch=maxY-minY+1;
  for(const size of [320,256,192,144]){
   const out=document.createElement("canvas"),scale=Math.min(1,size/Math.max(cw,ch));
   out.width=Math.max(1,Math.round(cw*scale));out.height=Math.max(1,Math.round(ch*scale));
   out.getContext("2d").drawImage(canvas,minX,minY,cw,ch,0,0,out.width,out.height);
   const encoded=out.toDataURL("image/webp",.78);
   if(valid(encoded))return {src:encoded,state};
  }
  throw Error("Η φωτογραφία δεν μπορεί να συμπιεστεί αρκετά. Δοκίμασε μικρότερη.");
 }finally{URL.revokeObjectURL(url)}
}
window.CarArt={valid,select,render,prepare,removeFlatBackground};
})();