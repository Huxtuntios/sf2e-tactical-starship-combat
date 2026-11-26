/** Локальный DOM-стенд: не заменяет Foundry или несколько клиентов. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootUrl = pathToFileURL(root).href;
const out = process.argv[2] ?? path.join(root, "dist", "ui-drop");
fs.mkdirSync(out, { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><main id="map"><div class="tsc-zone" data-zone="3"><button class="tsc-obj" data-object-key="Actor.old">ship</button></div><div class="tsc-zone" data-zone="7"></div></main><pre id="result">waiting</pre><script type="module">
import {wireSensorMapDragDrop} from '${rootUrl}/scripts/ui/sensor-drop-ui.mjs';
const state={enabled:true,zones:12,objects:[{key:'Actor.old',actorUuid:'Actor.old',zone:3}]};
globalThis.game={user:{isGM:true},settings:{get:()=>true},combats:new Map([['c',{flags:{'sf2e-tactical-starship-combat':{tsc:state}}}]])};
const actors={'Actor.new':{documentName:'Actor',uuid:'Actor.new',name:'Ship',type:'vehicle',flags:{'sf2e-tactical-starship-combat':{starship:{isStarship:true}}}},'Compendium.x.y.Actor.h':{documentName:'Actor',uuid:'Compendium.x.y.Actor.h',name:'Hazard',type:'hazard'}};
const sent=[],warned=[];let approved=true;const root=document.querySelector('#map');
const deps={send:async(type,payload)=>{sent.push(payload);return 'added'},resolve:async u=>actors[u],confirm:async()=>approved,warn:k=>warned.push(k),info:()=>{}};
wireSensorMapDragDrop(root,{combatId:'c',movableKeys:['Actor.old']},deps);wireSensorMapDragDrop(root,{combatId:'c',movableKeys:['Actor.old']},deps);
const zone=root.querySelector('[data-zone="7"]');const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
const fire=(name,payload)=>{const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify(payload));zone.dispatchEvent(new DragEvent(name,{bubbles:true,cancelable:true,dataTransfer:dt}));};
const wait=()=>new Promise(r=>setTimeout(r,0));
fire('dragover',{type:'Actor',uuid:'Actor.new'});check('highlight',zone.classList.contains('tsc-drop'));
approved=false;fire('drop',{type:'Actor',uuid:'Actor.new',name:'Fake'});await wait();check('cancel-no-request',sent.length===0);check('no-duplicate-listener',sent.length===0);check('clear-highlight',!zone.classList.contains('tsc-drop'));
fire('drop',{tscKey:'Actor.old'});await wait();check('existing-move',sent[0]?.op==='move'&&sent[0]?.zone===7);
fire('drop',{type:'Item',uuid:'Item.x'});await wait();check('unsupported-item-refused',sent.length===1&&warned.includes('SF2eTSC.mapDrop.unsupportedActor'));
approved=false;fire('drop',{type:'Actor',uuid:'Actor.new'});await wait();check('repeat-cancel-no-request',sent.length===1);
game.user.isGM=false;fire('drop',{type:'Actor',uuid:'Actor.new'});await wait();check('player-denied',sent.length===1&&warned.includes('SF2eTSC.errors.gmOnly'));
const {sensorUpdate}=await import('${rootUrl}/scripts/sensor/map-handlers.mjs');
const moduleId='sf2e-tactical-starship-combat';
const gm={id:'gm',isGM:true,active:true},player={id:'p1',isGM:false,active:true},users=new Map([['gm',gm],['p1',player]]);users.activeGM=gm;users.contents=[gm,player];
class ForcedDeletion {}
class ForcedReplacement { constructor(value){this.value=value;} static get(operator){return operator.value;} }
const isPlainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function mergeDocumentObject(current,patch){const merged=structuredClone(current);for(const [key,value] of Object.entries(patch)){if(value instanceof ForcedDeletion)delete merged[key];else if(value instanceof ForcedReplacement)merged[key]=structuredClone(ForcedReplacement.get(value));else if(isPlainObject(value))merged[key]=mergeDocumentObject(isPlainObject(merged[key])?merged[key]:{},value);else merged[key]=structuredClone(value);}return merged;}
function expandChanges(changes){const expanded={};for(const [path,value] of Object.entries(changes)){const parts=path.split('.');let target=expanded;for(const part of parts.slice(0,-1))target=(target[part]??={});target[parts.at(-1)]=value;}return expanded;}
function updateDocument(doc,changes){const current={name:doc.name,flags:doc.flags??{},ownership:doc.ownership??{},folder:doc.folder??null};Object.assign(doc,mergeDocumentObject(current,expandChanges(changes)));}
let sequence=0;const randomID=()=>(++sequence).toString(36).padStart(16,'0');
const worldActor={documentName:'Actor',id:'new',uuid:'Actor.new',name:'Ship',type:'vehicle',pack:null,isToken:false,ownership:{default:0,p1:3},testUserPermission:user=>user.isGM||user.id==='p1',flags:{[moduleId]:{starship:{isStarship:true,role:'player',heading:'right'}}},toObject(){return {_id:this.id,name:this.name,type:this.type,img:this.img,flags:structuredClone(this.flags),system:structuredClone(this.system??{}),ownership:structuredClone(this.ownership)};}};
const compendiumActors={};
for(const [id,name] of [['h1','First hazard'],['h2','Second hazard']]){const uuid='Compendium.x.y.Actor.'+id;compendiumActors[uuid]={documentName:'Actor',id,uuid,name,type:'hazard',pack:'x.y',isToken:false,ownership:{default:0},testUserPermission:user=>user.isGM===true,toObject(){return {_id:this.id,name:this.name,type:this.type,img:this.img,flags:structuredClone(this.flags??{}),system:structuredClone(this.system??{}),ownership:structuredClone(this.ownership)};}};}
const combat={id:'live-handler',active:true,flags:{[moduleId]:{tsc:{enabled:true,zones:12,objects:[]}}},combatants:new Map(),update:async changes=>{updateDocument(combat,changes);return combat;}};
globalThis.game={user:gm,users,actors:new Map([[worldActor.id,worldActor]]),journal:{contents:[]},combats:new Map([[combat.id,combat]]),combat,i18n:{localize:k=>k,format:k=>k},settings:{get:()=>null},time:{worldTime:100}};
globalThis.foundry={data:{operators:{ForcedDeletion,ForcedReplacement}},utils:{deepClone:value=>structuredClone(value),randomID}};
globalThis.Hooks={on:()=>1,off:()=>{},callAll:()=>{}};
globalThis.fromUuid=async uuid=>uuid===worldActor.uuid?worldActor:compendiumActors[uuid]??null;
globalThis.fromUuidSync=uuid=>uuid===worldActor.uuid?worldActor:compendiumActors[uuid]??null;
globalThis.JournalEntry={create:async data=>{const doc={id:'journal-'+randomID(),...structuredClone(data),testUserPermission(user,level){if(user?.isGM)return true;const granted=this.ownership?.[user?.id]??this.ownership?.default??0;return granted>=({LIMITED:1,OBSERVER:2,OWNER:3}[level]??0);},update:async changes=>{updateDocument(doc,changes);return doc;}};game.journal.contents.push(doc);return doc;}};
let actorCreations=0;globalThis.Actor={create:async data=>{actorCreations++;const id='copy-'+actorCreations;const copy={...data,id,uuid:'Actor.'+id,documentName:'Actor',pack:null,isToken:false};game.actors.set(id,copy);return copy;}};
const actualRoot=document.createElement('main');actualRoot.innerHTML='<div class="tsc-zone" data-zone="4"></div>';document.body.append(actualRoot);
const actualErrors=[];
wireSensorMapDragDrop(actualRoot,{combatId:combat.id},{resolve:fromUuid,confirm:async()=>true,send:async(type,payload)=>sensorUpdate({user:gm,payload}),warn:(key,data)=>actualErrors.push({key,data}),info:()=>{}});
const actualZone=actualRoot.firstElementChild;
const fireOn=(zone,name,payload)=>{const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify(payload));zone.dispatchEvent(new DragEvent(name,{bubbles:true,cancelable:true,dataTransfer:dt}));};
const fireActual=(name,payload)=>fireOn(actualZone,name,payload);
const actualDrop=(uuid=worldActor.uuid)=>fireActual('drop',{type:'Actor',uuid});
const settle=async()=>{await wait();await wait();};
actualDrop();await settle();
check('world-actor-drop-no-document-creation',actorCreations===0&&game.actors.size===1&&actualErrors.length===0);
const firstObject=combat.flags[moduleId].tsc.objects[0];
check('world-actor-drop-map-only-identity',firstObject?.key.startsWith('map-')===true&&firstObject.actorUuid===firstObject.key&&firstObject.mapOnly===true&&firstObject.zone===4&&!JSON.stringify(combat.flags).includes(worldActor.uuid));
actualDrop();await settle();
check('repeated-world-drop-adds-distinct-map-only-record',actorCreations===0&&game.actors.size===1&&combat.flags[moduleId].tsc.objects.length===2&&new Set(combat.flags[moduleId].tsc.objects.map(object=>object.key)).size===2&&combat.flags[moduleId].tsc.objects.every(object=>object.mapOnly&&object.actorUuid===object.key)&&combat.flags[moduleId].tsc.objects[0].zone===4&&actualErrors.length===0);
actualZone.dataset.zone='8';actualDrop();await settle();
check('third-world-drop-adds-another-map-only-record',actorCreations===0&&game.actors.size===1&&combat.flags[moduleId].tsc.objects.length===3&&new Set(combat.flags[moduleId].tsc.objects.map(object=>object.key)).size===3&&combat.flags[moduleId].tsc.objects.every(object=>object.mapOnly&&object.actorUuid===object.key)&&combat.flags[moduleId].tsc.objects[0].zone===4&&combat.flags[moduleId].tsc.objects.at(-1).zone===8&&actualErrors.length===0);
const selectedKey=combat.flags[moduleId].tsc.objects[1].key;const dragRoot=document.createElement('main');dragRoot.innerHTML='<div class="tsc-zone" data-zone="9"></div>';document.body.append(dragRoot);wireSensorMapDragDrop(dragRoot,{combatId:combat.id,movableKeys:combat.flags[moduleId].tsc.objects.map(object=>object.key)},{resolve:fromUuid,confirm:async()=>true,send:async(type,payload)=>sensorUpdate({user:gm,payload}),warn:(key,data)=>actualErrors.push({key,data}),info:()=>{}});fireOn(dragRoot.firstElementChild,'drop',{tscKey:selectedKey});await settle();
check('existing-record-drag-moves-only-selected-key',combat.flags[moduleId].tsc.objects.map(object=>object.zone).join(',')==='4,9,8'&&actorCreations===0&&actualErrors.length===0);
const nonFirstUuid='Compendium.x.y.Actor.h2';actualZone.dataset.zone='5';actualDrop(nonFirstUuid);await settle();
const firstStore=game.journal.contents[0].flags[moduleId].privateSensor;const firstContact=firstStore.contacts[0];const firstSnapshot=firstStore.mapObjects[firstContact.key];
check('non-first-compendium-drop-creates-private-map-snapshot',firstSnapshot?.sourceUuid===nonFirstUuid&&firstContact.key.startsWith('map-')&&firstContact.mapOnly===true&&firstContact.zone===5&&actorCreations===0&&game.actors.size===1&&!JSON.stringify(combat.flags).includes(nonFirstUuid)&&actualErrors.length===0);
actualZone.dataset.zone='6';actualDrop(nonFirstUuid);await settle();
const store=game.journal.contents[0].flags[moduleId].privateSensor;const contacts=store.contacts;
check('repeated-non-first-compendium-drop-is-independent',contacts.length===2&&new Set(contacts.map(contact=>contact.key)).size===2&&contacts.every(contact=>contact.mapOnly&&store.mapObjects[contact.key].sourceUuid===nonFirstUuid)&&contacts.map(contact=>contact.zone).join(',')==='5,6'&&actorCreations===0&&game.actors.size===1&&combat.flags[moduleId].tsc.objects.length===3&&actualErrors.length===0);
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(x=>x.pass),diagnostics:actualErrors,state:{actorCreations,actors:game.actors.size,objects:combat.flags[moduleId].tsc.objects.map(object=>({key:object.key,actorUuid:object.actorUuid,mapOnly:object.mapOnly,zone:object.zone})),contacts:contacts.map(contact=>({key:contact.key,sourceUuid:store.mapObjects[contact.key].sourceUuid,mapOnly:contact.mapOnly,zone:contact.zone}))}});
</script>`;
fs.writeFileSync(`${out}/sensor-drop.html`, html);
console.log(`Wrote sensor drop fixture to ${out}`);
