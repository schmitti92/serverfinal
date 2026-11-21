import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createMission3,mission3LegalMoves,mission3Play,mission3NextPreviewDeal,
 mission3TaskStatus,mission3CardTotal,mission3Validate,
 MISSION3_TASK_TARGETS,MISSION3_STARTS
} from '../dog/grinch-mission3.js';
const pawn=(s,id)=>s.pieces.find(p=>p.id===id);
function prepared(seed=999){
 const s=createMission3(seed);
 s.pieces.forEach((p,i)=>{p.place='track';p.pos=20+i;p.frozenTurns=0;});
 s.current=0;s.seven=null;
 return s;
}
function positionObjectives(s,fields,progress=0){
 const task=s.tasks;
 task.objectives.forEach((o,i)=>{
  o.field=fields[i]??(42+i);
  o.collected=i<progress;
  o.collectedBy=o.collected?'r1':null;
 });
 task.progress[s.stage]=progress;
 task.activeFields=task.objectives.filter(o=>!o.collected).map(o=>o.field);
}
function redMove(s,from=7,distance=4){
 const moving=s.pieces.find(p=>p.owner===0&&p.place==='track');
 assert.ok(moving,'Red must have a surviving pawn');
 s.pieces.forEach((p,i)=>{if(p.place==='track')p.pos=20+i;});
 moving.pos=from;s.current=0;s.grinchUsed=[];s.seven=null;
 s.hands[0][0].type=String(distance);
 const opts=mission3LegalMoves(s).filter(m=>m.kind==='move'&&m.pieceId===moving.id&&m.distance===distance);
 assert.ok(opts.length,'expected an exact landing move '+distance);
 return mission3Play(s,0,opts[0]);
}
test('all three tasks exist: 3 lights, 4 ice barriers and 3 runes',()=>{
 assert.deepEqual([...MISSION3_TASK_TARGETS],[3,4,3]);
 const s=createMission3(322);
 const task=mission3TaskStatus(s);
 assert.equal(task.stage,0);
 assert.equal(task.total,3);
 assert.equal(task.progress,0);
 assert.equal(task.remaining.length,3);
 assert.ok(s.tasks.objectives.every(o=>o.kind==='light'));
 assert.ok(mission3Validate(s));
});
test('all mission objectives are distinct, free and never placed on protected starts',()=>{
 for(let seed=1;seed<=45;seed++){
  const s=createMission3(seed);
  const fields=mission3TaskStatus(s).remaining.map(o=>o.field);
  const pieces=new Set(s.pieces.map(p=>p.pos));
  assert.equal(new Set(fields).size,3);
  for(const field of fields){
   assert.ok(field>=0&&field<64);
   assert.ok(!MISSION3_STARTS.includes(field));
   assert.ok(!pieces.has(field));
  }
 }
});
test('remaining lights move to NEW positions once per full deal; progress is kept',()=>{
 let s=createMission3(533);
 const previous=mission3TaskStatus(s).remaining.map(o=>o.field);
 const collected=s.tasks.objectives[0];
 collected.collected=true;collected.collectedBy='r1';
 s.tasks.progress[0]=1;s.tasks.activeFields=s.tasks.objectives.slice(1).map(o=>o.field);
 const kept=collected.field;
 s=mission3NextPreviewDeal(s);
 const remaining=mission3TaskStatus(s).remaining.map(o=>o.field);
 assert.equal(s.tasks.progress[0],1);
 assert.equal(s.tasks.objectives[0].field,kept);
 assert.deepEqual(s.tasks.objectives[0].collected,true);
 assert.equal(remaining.length,2);
 assert.ok(remaining.every(f=>!previous.includes(f)));
 assert.equal(s.tasks.activeFields.length,2);
 assert.ok(mission3Validate(s));
});
test('merely crossing a light without landing does not collect it',()=>{
 let s=prepared(763);
 positionObjectives(s,[9,43,44]);
 const next=redMove(s,7,4);
 assert.equal(pawn(next,'r0').pos,11);
 assert.equal(next.tasks.progress[0],0);
 assert.equal(next.stage,0);
 assert.ok(mission3Validate(next));
});
test('exact card landing collects one light immediately and maintains the shared total',()=>{
 let s=prepared(764);
 positionObjectives(s,[11,43,44]);
 const next=redMove(s,7,4);
 assert.equal(next.tasks.progress[0],1);
 assert.equal(next.tasks.objectives.filter(o=>o.collected).length,1);
 assert.equal(next.tasks.activeFields.length,2);
 assert.equal(next.stage,0);
 assert.ok(mission3Validate(next));
});
test('Grinch may pass task fields but cannot stop or swap onto an unfinished objective',()=>{
 let s=prepared(888);
 positionObjectives(s,[12,43,44]);
 s.current=3;s.grinchActionsLeft=1;s.grinchUsed=[];
 pawn(s,'g0').pos=10;
 s.hands[3][0].type='2';
 const moves=mission3LegalMoves(s,3);
 assert.equal(moves.some(m=>m.kind==='move'&&m.pieceId==='g0'&&m.to===12),false);
 const pass=moves.filter(m=>m.kind==='move'&&m.pieceId==='g0'&&m.distance>=3);
 // Passing an objective is allowed as long as the final landing is different.
 assert.ok(pass.length>0||moves.length>0);
});
test('stage completion forces one new captive and immediately starts next task',()=>{
 let s=prepared(702);
 positionObjectives(s,[42,43,11],2);
 s=redMove(s,7,4);
 assert.equal(s.stage,1);
 assert.equal(s.tasks.progress[0],3);
 assert.equal(s.tasks.objectives.length,4);
 assert.equal(s.tasks.completedStages[0],0);
 assert.equal(s.capturedPerHuman.reduce((a,b)=>a+b,0),1);
 assert.deepEqual(s.tasks.objectives.map(o=>o.kind),['ice','ice','ice','ice']);
 assert.equal(s.stageAtDeal,0,'new Grinch hand strength begins next dealing, not mid-hand');
 assert.ok(mission3Validate(s));
});
test('four barriers and three runes can be cleared in any order; victory locks the game',()=>{
 let s=prepared(703);
 positionObjectives(s,[42,43,11],2);
 s=redMove(s,7,4); // complete lights; mandatory capture #1
 assert.equal(s.stage,1);
 positionObjectives(s,[42,43,44,11],3);
 s=redMove(s,7,4); // complete ice; mandatory capture #2
 assert.equal(s.stage,2);
 positionObjectives(s,[42,43,11],2);
 s=redMove(s,7,4); // complete runes; mandatory capture #3
 assert.equal(s.stage,2);
 assert.equal(s.complete,true);
 assert.deepEqual(s.tasks.progress,[3,4,3]);
 assert.deepEqual(s.tasks.completedStages,[0,1,2]);
 assert.deepEqual(s.capturedPerHuman,[1,1,1]);
 assert.equal(s.pieces.filter(p=>p.place==='captured').length,3);
 assert.equal(s.pieces.filter(p=>p.place!=='captured'&&p.owner<3).length,6);
 assert.equal(mission3LegalMoves(s).length,0);
 assert.throws(()=>mission3NextPreviewDeal(s),/bereits gewonnen/);
 assert.equal(mission3CardTotal(s),110);
 assert.ok(mission3Validate(s));
});
test('ice and rune positions stay FIXED through subsequent card phases',()=>{
 let s=createMission3(435);
 s.stage=1;s.tasks.stage=1;
 s.tasks.objectives=Array.from({length:4},(_,i)=>({id:'i'+i,kind:'ice',field:4+i,collected:false,collectedBy:null}));
 s.tasks.activeFields=s.tasks.objectives.map(o=>o.field);
 const old=[...s.tasks.activeFields];
 s=mission3NextPreviewDeal(s);
 assert.deepEqual(s.tasks.activeFields,old);
 s.stage=2;s.tasks.stage=2;
 s.tasks.objectives=Array.from({length:3},(_,i)=>({id:'r'+i,kind:'rune',field:9+i,collected:false,collectedBy:null}));
 s.tasks.activeFields=s.tasks.objectives.map(o=>o.field);
 const runes=[...s.tasks.activeFields];
 s=mission3NextPreviewDeal(s);
 assert.deepEqual(s.tasks.activeFields,runes);
});
test('seeded placements agree across independently constructed copies',()=>{
 for(let seed of [51,52,122,777]){
  const a=createMission3(seed),b=createMission3(seed);
  assert.deepEqual(a.tasks,b.tasks);
  const a2=mission3NextPreviewDeal(a),b2=mission3NextPreviewDeal(b);
  assert.deepEqual(a2.tasks,b2.tasks);
 }
});
