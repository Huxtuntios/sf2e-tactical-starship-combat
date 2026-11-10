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
globalThis.game={user:{isGM:true},combats:new Map([['c',{flags:{'sf2e-tactical-starship-combat':{tsc:state}}}]])};
const actors={'Actor.new':{documentName:'Actor',uuid:'Actor.new',name:'Ship',type:'vehicle',flags:{'sf2e-tactical-starship-combat':{starship:{isStarship:true}}}},'Compendium.x.y.Actor.h':{documentName:'Actor',uuid:'Compendium.x.y.Actor.h',name:'Hazard',type:'hazard'}};
const sent=[],warned=[];let approved=true;const root=document.querySelector('#map');
const deps={send:async(type,payload)=>{sent.push(payload);return 'added'},resolve:async u=>actors[u],confirm:async()=>approved,warn:k=>warned.push(k),info:()=>{}};
wireSensorMapDragDrop(root,{combatId:'c',movableKeys:['Actor.old']},deps);wireSensorMapDragDrop(root,{combatId:'c',movableKeys:['Actor.old']},deps);
const zone=root.querySelector('[data-zone="7"]');const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
const fire=(name,payload)=>{const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify(payload));zone.dispatchEvent(new DragEvent(name,{bubbles:true,cancelable:true,dataTransfer:dt}));};
const wait=()=>new Promise(r=>setTimeout(r,0));
fire('dragover',{type:'Actor',uuid:'Actor.new'});check('highlight',zone.classList.contains('tsc-drop'));
fire('drop',{type:'Actor',uuid:'Actor.new',name:'Fake'});await wait();check('actor-zone-and-disclosure',sent.length===1&&sent[0].actorUuid==='Actor.new'&&sent[0].zone===7&&sent[0].publicActor===true);check('no-duplicate-listener',sent.length===1);check('clear-highlight',!zone.classList.contains('tsc-drop'));
fire('drop',{tscKey:'Actor.old'});await wait();check('existing-move',sent[1]?.op==='move'&&sent[1]?.zone===7);
fire('drop',{type:'Actor',uuid:'Compendium.x.y.Actor.h'});await wait();check('compendium-hazard-refused',sent.length===2&&warned.includes('SF2eTSC.errors.generic'));
approved=false;fire('drop',{type:'Actor',uuid:'Actor.new'});await wait();check('cancel-no-request',sent.length===2);
game.user.isGM=false;fire('drop',{type:'Actor',uuid:'Actor.new'});await wait();check('player-denied',sent.length===2&&warned.includes('SF2eTSC.errors.gmOnly'));
document.querySelector('#result').textContent=JSON.stringify({checks,passed:checks.every(x=>x.pass)});
</script>`;
fs.writeFileSync(`${out}/sensor-drop.html`, html);
console.log(`Wrote sensor drop fixture to ${out}`);
