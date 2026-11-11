/** Real PNG decoding + production SensorMapApplication lifecycle, with mocked Foundry PARTS replacement. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDeflate } from "node:zlib";
import { Readable } from "node:stream";
import Handlebars from "handlebars";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "ui-tests", "sensor-performance");
fs.mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
async function png(name, width, height) {
  // Stream repeated scanlines: actual RGB PNG dimensions, without allocating a giant raw buffer or using Pillow.
  const row = Buffer.alloc(width * 3 + 1);
  for (let x = 0; x < width; x++) {
    row[x * 3 + 1] = x % 256;
    row[x * 3 + 2] = 96;
    row[x * 3 + 3] = 160;
  }
  const compressed = [];
  const input = Readable.from(
    (function* () {
      for (let y = 0; y < height; y++) yield row;
    })()
  );
  for await (const buffer of input.pipe(createDeflate())) compressed.push(buffer);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(
    path.join(out, name),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", Buffer.concat(compressed)),
      chunk("IEND", Buffer.alloc(0))
    ])
  );
}
await png("giant.png", 8100, 11700);
await png("ordinary.png", 512, 512);
const templates = ["bar", "zones", "detail", "dock"]
  .map((part) => {
    const source = fs.readFileSync(path.join(root, "templates", `sensor-map-${part}.hbs`), "utf8");
    return `${JSON.stringify(part)}: Handlebars.template(${Handlebars.precompile(source)})`;
  })
  .join(",\n");

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${rootUrl}/styles/main.css">
<style>body{margin:0;background:#777;font:14px Arial}.tsc-sensor-map{width:1060px;height:850px}.window-content{height:100%}#result{position:fixed;bottom:0;background:white;color:black;max-height:100px;overflow:auto}</style>
<main id="app" class="application sf2e-tsc tsc-sensor-map"><div class="window-content"></div></main><pre id="result">waiting</pre>
<script src="${rootUrl}/node_modules/handlebars/dist/handlebars.runtime.js"></script>
<script type="module">
const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
try {
const templates={${templates}};
Handlebars.registerHelper('localize', key=>key);
const metrics={loads:0,draws:0,resolve:0,read:0,stats:0,preSync:0,sync:0};
const NativeImage=globalThis.Image;
globalThis.Image=class extends NativeImage {
  set src(value){if(value)metrics.loads++;super.src=value;}
  get src(){return super.src;}
};
const nativeContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(...args){
  const ctx=nativeContext.apply(this,args);
  if(ctx&&!ctx.instrumented){ctx.instrumented=true;const draw=ctx.drawImage;ctx.drawImage=function(...values){metrics.draws++;return draw.apply(this,values);};}
  return ctx;
};
const blobs=[],revoked=[];
const nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=nativeCreate(blob);blobs.push(url);return url;};
URL.revokeObjectURL=url=>{revoked.push(url);nativeRevoke(url);};
class ApplicationV2 {
  constructor(){this.element=document.querySelector('#app');this.rendered=false;}
  _preSyncPartState(){metrics.preSync++;}
  _syncPartState(){metrics.sync++;}
  async render(options={}) {
    if(typeof options!=='object')options={};
    const context=await this._prepareContext(options);
    await this._preRender?.(context,options);
    const parent=this.element.querySelector('.window-content');
    for(const partId of options.parts??Object.keys(this.constructor.PARTS)){
      const wrapper=document.createElement('template');wrapper.innerHTML=templates[partId](context);
      const next=wrapper.content.firstElementChild;next.dataset.applicationPart=partId;
      const prior=parent.querySelector('[data-application-part="'+partId+'"]');
      if(prior){const state={};this._preSyncPartState(partId,next,prior,state);prior.replaceWith(next);this._syncPartState(partId,next,prior,state);}
      else parent.append(next);
    }
    if(!this.rendered){this.rendered=true;this._onFirstRender?.(context,options);}
    this._onRender(context,options);
    return this;
  }
  close(){this._onClose?.({});this.rendered=false;}
}
globalThis.foundry={applications:{api:{ApplicationV2,HandlebarsApplicationMixin:Base=>Base,DialogV2:{}}},utils:{deepClone:structuredClone}};
const hookHandlers=new Map();let hookId=0;
globalThis.Hooks={on:(name,fn)=>{const id=++hookId;hookHandlers.set(id,{name,fn});return id;},off:(_name,id)=>hookHandlers.delete(id),callAll:(name,...args)=>{for(const h of hookHandlers.values())if(h.name===name)h.fn(...args);}};
globalThis.canvas={tokens:{controlled:[]}};
const MODULE='sf2e-tactical-starship-combat';
const actors=Array.from({length:12},(_,i)=>({id:'actor-'+i,uuid:'Actor.actor-'+i,type:'vehicle',name:'Ship '+i,
  flags:{[MODULE]:{starship:{isStarship:true,dataVersion:20,role:'npc',level:3,sp:{value:20,max:30}}}},
  system:{attributes:{hp:{value:50,max:100}}},testUserPermission:()=>true}));
const state={enabled:true,zones:12,objects:Array.from({length:360},(_,i)=>({key:'object-'+i,actorUuid:actors[i%12].uuid,type:'starship',name:'Object '+i,zone:i%12+1,heading:'right'})),log:[],appearance:{background:'giant.png',blur:0}};
const combat={id:'combat',round:1,flags:{[MODULE]:{tsc:state}},combatants:[]};
const settings={get:(module,key)=>key==='starshipSheetTheme'?'dark':key==='uiState'?{}:key==='showUnknownContacts'?true:undefined,set:async()=>{}};
globalThis.game={user:{id:'gm',role:4,isGM:true},actors,combat,combats:[combat],journal:{contents:[]},settings,i18n:{localize:key=>key,has:()=>false}};
globalThis.ui={notifications:{error:message=>{throw new Error(message);}}};
globalThis.fromUuidSync=uuid=>actors.find(a=>a.uuid===uuid)??null;
globalThis.fromUuid=async uuid=>{metrics.resolve++;return fromUuidSync(uuid);};
const {SensorMapApplication,invalidateSensorMapActors}=await import('${rootUrl}/scripts/ui/sensor-map-app.mjs');
const {MapActorCache}=await import('${rootUrl}/scripts/sensor/map-actor-cache.mjs');
const {readStarship}=await import('${rootUrl}/scripts/starship/starship-state.mjs');
const {computeShipStats}=await import('${rootUrl}/scripts/starship/stats.mjs');
const {backgroundReady}=await import('${rootUrl}/scripts/ui/map-background.mjs');
const {openApps}=await import('${rootUrl}/scripts/ui/base-app.mjs');
const app=new SensorMapApplication();
app.actorCache=new MapActorCache({read:actor=>{metrics.read++;return readStarship(actor);},stats:actor=>{metrics.stats++;return computeShipStats(actor);}});
app.selected='object-0';
await app.render();
const layer=app.element.querySelector('.tsc-map-background');
check('no-native-giant-css-before-preparation',!layer.style.backgroundImage.includes('giant.png'));
const initialReady=backgroundReady(layer);
await app.render({parts:['zones']});
check('in-flight-loader-survives-part-replacement',app.element.querySelector('.tsc-map-background')===layer&&backgroundReady(layer)===initialReady&&metrics.loads===1);
await initialReady;
check('actual-giant-scaled',layer.dataset.backgroundState==='scaled'&&layer.dataset.backgroundWidth==='2836'&&layer.dataset.backgroundHeight==='4096');
const display=layer.style.backgroundImage;
const scaled=await createImageBitmap(await (await fetch(blobs[0])).blob());
check('actual-scaled-blob-dimensions',scaled.width===2836&&scaled.height===4096);scaled.close();
check('original-path-untouched',state.appearance.background==='giant.png'&&layer.dataset.backgroundSource==='giant.png');
check('360-production-objects',app.element.querySelectorAll('[data-object-key]').length===360);
for(let i=0;i<8;i++){
  const detail=app.element.querySelector('[data-application-part="detail"]');
  const dock=app.element.querySelector('[data-application-part="dock"]');
  state.objects[0].zone=i%12+1;
  await app.render({parts:['zones']});
  check('zones-retains-other-parts-'+i,detail===app.element.querySelector('[data-application-part="detail"]')&&dock===app.element.querySelector('[data-application-part="dock"]'));
  await app.render({parts:['detail']});
  const zones=app.element.querySelector('[data-application-part="zones"]');
  const currentDetail=app.element.querySelector('[data-application-part="detail"]');
  await app.render({parts:['dock']});
  check('dock-retains-map-detail-'+i,zones===app.element.querySelector('[data-application-part="zones"]')&&currentDetail===app.element.querySelector('[data-application-part="detail"]'));
  check('same-node-source-'+i,app.element.querySelector('.tsc-map-background')===layer&&layer.style.backgroundImage===display);
}
await app.render();
check('full-render-retains-background',app.element.querySelector('.tsc-map-background')===layer&&layer.style.backgroundImage===display);
check('public-pre-sync-super-and-post-sync',metrics.preSync===29&&metrics.preSync===metrics.sync);
check('one-load-draw-through-all-renders',metrics.loads===1&&metrics.draws===1);
check('one-resolution-data-per-unique-actor',metrics.resolve===12&&metrics.read===12&&metrics.stats===1);
actors[0].system.attributes.hp.value=8;
invalidateSensorMapActors(actors[0]);
// Use production invalidation/refresh scheduling; assert after its merged render rather than a hand refresh.
await new Promise(resolve=>setTimeout(resolve,120));
check('actor-hook-refreshes-map-detail',app.element.querySelector('[data-object-key="object-0"]').title.includes('8/100')&&app.element.querySelector('[data-application-part="detail"]').textContent.includes('8/100')&&metrics.resolve===13&&metrics.read===13&&metrics.stats===2);
state.appearance.background='ordinary.png';
await app.render({parts:['zones']});await backgroundReady(layer);
check('ordinary-native-source',layer.dataset.backgroundState==='original'&&layer.style.backgroundImage.includes('ordinary.png')&&!layer.style.backgroundImage.includes('blob:'));
check('giant-url-revoked-on-source-change',revoked.includes(blobs[0]));
const ordinary=layer.style.backgroundImage;
await app.render({parts:['zones','detail']});
check('ordinary-no-reload-no-upscale',metrics.loads===2&&metrics.draws===1&&layer.style.backgroundImage===ordinary&&layer.dataset.backgroundWidth==='512');
state.appearance.background='giant.png';
await app.render({parts:['zones']});await backgroundReady(layer);
const lastBlob=blobs.at(-1);
app.close();
check('close-releases-layer-and-cache',revoked.includes(lastBlob)&&app.actorCache.entries.size===0&&app.actorCache.active.size===0&&openApps(SensorMapApplication).length===0&&hookHandlers.size===0&&layer.style.backgroundImage==='none');
const notifications=[];
ui.notifications.info=message=>notifications.push(message);
ui.notifications.warn=message=>notifications.push(message);
game.i18n.format=(key,data)=>key+':'+data.count;
game.users={activeGM:game.user,contents:[game.user],get:id=>id===game.user.id?game.user:null};
let nextId=0,writes=0,failFinalize=true,pauseFinalize=false,resumeFinalize;
foundry.utils.randomID=()=>String(++nextId).padStart(16,'0');
const apply=(doc,changes)=>{for(const [path,value] of Object.entries(changes)){const keys=path.split('.');let parent=doc;for(const key of keys.slice(0,-1))parent=parent[key]??={};parent[keys.at(-1)]=structuredClone(value);}writes++;return doc;};
combat.update=async changes=>apply(combat,changes);
globalThis.JournalEntry={create:async data=>{const doc={...structuredClone(data),id:'private-store',testUserPermission:user=>user.isGM,update:async changes=>{
  if(Object.hasOwn(changes,'flags.'+MODULE+'.privateSensor.completedReveals')){
    if(failFinalize)throw new Error('finalization unavailable');
    if(pauseFinalize)await new Promise(resolve=>resumeFinalize=resolve);
  }
  return apply(doc,changes);
}};game.journal.contents.push(doc);return doc;}};
const {addPrivateCustom,changePrivateContact,pendingPrivateReveals}=await import('${rootUrl}/scripts/sensor/private-contacts.mjs');
const key=await addPrivateCustom(combat,'Recovery contact',4);
try{await changePrivateContact(combat,key,'reveal');check('reveal-fault-exercised',false);}catch{check('reveal-fault-exercised',true);}
combat.flags[MODULE].tsc.appearance.background='';
const recoveryApp=new SensorMapApplication();
await recoveryApp.render();
check('pending-count-survives-filtered-private-contact',recoveryApp._privateObjects.length===0&&recoveryApp.element.querySelector('[data-action="recoverReveals"]')?.textContent.trim()==='1');
const action=SensorMapApplication.DEFAULT_OPTIONS.actions.recoverReveals;
let recoveryPromise;
const clickRecovery=()=>{const button=recoveryApp.element.querySelector('[data-action="recoverReveals"]');button.addEventListener('click',event=>{recoveryPromise=action.call(recoveryApp,event,button);},{once:true});button.click();return button;};
let recoveryButton=clickRecovery();await recoveryPromise;await recoveryApp.render();
check('failed-recovery-releases-button',!recoveryButton.disabled&&!recoveryApp._recoveringReveals&&pendingPrivateReveals(combat.id).length===1);
check('failed-recovery-actionable-warning',notifications.some(message=>message.startsWith('SF2eTSC.privateMap.recoveryFailed')));
failFinalize=false;pauseFinalize=true;
recoveryButton=clickRecovery();
check('recovery-click-busy-disabled',recoveryButton.disabled&&recoveryApp._recoveringReveals);
await new Promise(resolve=>setTimeout(resolve,0));resumeFinalize();await recoveryPromise;await recoveryApp.render();
check('successful-recovery-clears-intent-and-control',pendingPrivateReveals(combat.id).length===0&&!recoveryButton.disabled&&!recoveryApp._recoveringReveals&&!recoveryApp.element.querySelector('[data-action="recoverReveals"]'));
const written=writes;await action.call(recoveryApp,{},recoveryButton);
check('repeat-recovery-does-not-write',writes===written);
game.user={id:'player',isGM:false,role:1};await recoveryApp.render();
check('player-has-no-recovery-control',!recoveryApp.element.querySelector('[data-action="recoverReveals"]'));
await action.call(recoveryApp,{},recoveryButton);check('player-recovery-cannot-write',writes===written);
recoveryApp.close();
check('recovery-close-removes-instance-hooks',hookHandlers.size===0);
document.querySelector('#result').textContent=JSON.stringify({checks,metrics,passed:checks.every(x=>x.pass)});
}catch(error){document.querySelector('#result').textContent=JSON.stringify({checks,passed:false,error:error.stack});}
</script>`;
fs.writeFileSync(path.join(out, "sensor-performance.html"), html);
console.log(`Wrote production Sensor Map performance fixture to ${out}`);
