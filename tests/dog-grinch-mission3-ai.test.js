import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createMission3,mission3PlanGrinchTurn,mission3ChooseGrinchMove,mission3AutoGrinch,
 mission3LegalMoves,mission3Play,mission3SetPreviewStage,mission3NextPreviewDeal,
 mission3Validate,mission3CardTotal,MISSION3_AI_VERSION
} from '../dog/grinch-mission3.js';

const duplicate=s=>JSON.parse(JSON.stringify(s));
const get=(s,id)=>s.pieces.find(p=>p.id===id);
function grinchTurn(seed,stage=0){
 let s=createMission3(seed);
 if(stage){s=mission3SetPreviewStage(s,stage);s=mission3NextPreviewDeal(s);}
 s.current=3;s.grinchActionsLeft=stage+1;s.grinchUsed=[];
 return s;
}
const sameMove=(x,y)=>x.kind===y.kind&&x.cardId===y.cardId&&x.as===y.as&&
 x.pieceId===y.pieceId&&x.targetId===y.targetId&&x.distance===y.distance;

test('tactical AI is deterministic, non-mutating and provides legal first card actions',()=>{
 assert.match(MISSION3_AI_VERSION,/tactical-beam/);
 for(const stage of [0,1,2])for(const seed of [23,24,25]){
  const s=grinchTurn(seed,stage),before=JSON.stringify(s);
  const one=mission3PlanGrinchTurn(s),two=mission3PlanGrinchTurn(s);
  assert.deepEqual(one,two);
  assert.equal(JSON.stringify(s),before,'planning does not mutate authoritative game state');
  assert.ok(one.moves.length>=1);
  assert.ok(mission3LegalMoves(s,3).some(m=>sameMove(m,one.moves[0])));
  assert.deepEqual(mission3ChooseGrinchMove(s),one.moves[0]);
  assert.ok(Number.isFinite(one.score));
 }
});
test('Grinch plans do not peek into the three humans hidden card types or card IDs',()=>{
 const s=grinchTurn(637,2);
 const first=mission3PlanGrinchTurn(s);
 const changed=duplicate(s);
 for(let owner=0;owner<3;owner++){
  changed.hands[owner].reverse();
  for(const card of changed.hands[owner]){card.type='joker';card.id-=owner*1300+2000;}
 }
 assert.deepEqual(mission3PlanGrinchTurn(changed),first);
});
test('AI prioritizes guaranteed hits over aimless movement',()=>{
 const s=grinchTurn(901);
 const positions=[10,20,30,35,39,45,50,55,61,7,14,17,23,27];
 s.pieces.forEach((pawn,i)=>{pawn.place='track';pawn.pos=positions[i];});
 s.hands[3].forEach(card=>{card.type='3';});
 const choice=mission3ChooseGrinchMove(s);
 assert.ok(choice.captureIds?.length>0,'attack is preferred when it is available');
 const after=mission3Play(s,3,choice);
 assert.ok(after.pieces.some((p,i)=>p.owner<3&&p.place!==s.pieces[i].place||
  p.owner<3&&p.pos!==s.pieces[i].pos));
 assert.ok(mission3Validate(after));
});
test('visible mission-objective fields influence Grinch defensive positioning',()=>{
 const s=grinchTurn(902);
 s.pieces.forEach((p,i)=>{
  p.place=p.owner===3?'track':'home';
  p.pos=p.owner===3?[9,20,30,40,50][i-9]:-1;
 });
 s.tasks={activeFields:[12]};
 s.hands[3].forEach(card=>{card.type='2';});
 const choice=mission3ChooseGrinchMove(s);
 assert.equal(choice.pieceId,'g0');
 assert.equal(choice.to,11,'Grinch guards an adjacent field without blocking an invincible objective');
 assert.notEqual(choice.to,12,'unfinished mission objectives must stay accessible');
 assert.equal(choice.kind,'move');
});
test('multi-step plans use own 6/12/18-card hand, can replay legally and preserve 110 cards',()=>{
 for(const stage of [0,1,2])for(const seed of [89,90,91]){
  let s=grinchTurn(seed,stage);
  const currentHand=s.hands[3].length;
  assert.equal(currentHand,6*(stage+1));
  const plan=mission3PlanGrinchTurn(s);
  for(const m of plan.moves){
   if(s.current!==3)break;
   assert.ok(mission3LegalMoves(s,3).some(x=>sameMove(x,m)),
    'planned follow-up must be legal, including distinct Grinch pawns');
   s=mission3Play(s,3,m);
   assert.equal(mission3CardTotal(s),110);
   assert.ok(mission3Validate(s));
  }
  if(s.current===3)s=mission3AutoGrinch(s);
  assert.ok(s.current>=0&&s.current<3,'control returns to a human; players without legal moves can be automatically skipped');
  assert.ok(mission3Validate(s));
 }
});
test('AI resolves an entire split-seven action and may use several submoves',()=>{
 let splitRounds=0;
 for(let seed=80;seed<105;seed++){
  const s=grinchTurn(seed);
  const planned=mission3PlanGrinchTurn(s);
  if(planned.moves[0]?.kind!=='seven')continue;
  splitRounds++;
  const after=mission3AutoGrinch(s);
  assert.equal(after.current,0);
  assert.equal(after.seven,null);
  assert.equal(mission3CardTotal(after),110);
  assert.ok(mission3Validate(after));
 }
 assert.ok(splitRounds>0,'at least one seeded turn takes advantage of the 7');
});
test('AI never transfers hidden Grinch hands into public projections',async()=>{
 const {mission3Projection}=await import('../dog/grinch-mission3.js');
 let s=grinchTurn(774,2);
 const before=mission3Projection(s,0);
 mission3PlanGrinchTurn(s);
 const after=mission3Projection(s,0);
 assert.deepEqual(after,before);
 assert.equal(after.hands[3].length,0);
 assert.equal(after.seed,null);
});
