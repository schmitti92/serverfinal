/** Gemeinsame Spielesammlung-Lobby (Phase 1).
 * Single Firestore room across games; no client-side authority or local profile state.
 * Deliberately DOES NOT launch legacy games until they have safe room adapters.
 */
import { randomInt, randomUUID } from 'node:crypto';

export const HUB_GAMES = Object.freeze({
  barikade: { title:'Barikade', min:2, max:4 },
  skyjo: { title:'SKYJO Action', min:2, max:5 },
  kreuz: { title:'KreuzKunter', min:2, max:6 },
  business: { title:'Das große Business', min:2, max:5 },
  partychallenge: { title:'Party Challenge', min:2, max:4 },
});
const CHALLENGE_READY_GAMES=Object.freeze(['zeitgefuehl','recheninsel','huetchen-challenge','maulwurf-arena','flusssprung','lava-arena','snake-arena','bomber-strand-arena','preisjaeger']);
const CHALLENGE_GAMES=Object.freeze(['lava-arena','maulwurf-arena','recheninsel','flusssprung','zeitgefuehl','huetchen-challenge','snake-arena','bomber-strand-arena','preisjaeger']);
const CHARSET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN=/^[A-HJ-NP-Z2-9]{6}$/;
const COLLECTION='spielesammlung_hub_v1';
const HUB_BARIKADE_CODE=/^B[A-HJ-NP-Z2-9]{9}$/;
const HUB_KREUZ_CODE=/^K[A-HJ-NP-Z2-9]{9}$/;
const HUB_SKYJO_CODE=/^S[A-HJ-NP-Z2-9]{9}$/;
const HUB_BUSINESS_CODE=/^D[A-HJ-NP-Z2-9]{9}$/;
const BUSINESS_DEFAULTS=Object.freeze({rounds:20});
function businessSettings(raw){const rounds=Number(raw?.rounds??20);return [10,20,30].includes(rounds)?{rounds}:null;}
function uniqueBusinessNames(players){const used=new Set();return players.map((p,i)=>{const stem=cleanName(p.name).slice(0,18)||`Spieler ${i+1}`;let name=stem,serial=2;while(used.has(name.toLowerCase())){const suffix=` ${serial++}`;name=stem.slice(0,18-suffix.length)+suffix;}used.add(name.toLowerCase());return {...p,name};});}
const SKYJO_DEFAULTS=Object.freeze({target:100,beginner:false,jokerCount:8,jokerEnabled:true,streetModeEnabled:true,boardTheme:'classic',layoutMode:'classic'});
function skyjoSettings(raw){
 const v={...SKYJO_DEFAULTS,...(raw||{})};
 if(!Number.isInteger(v.target)||v.target<50||v.target>500||v.target%10!==0
   ||typeof v.beginner!=='boolean'||!Number.isInteger(v.jokerCount)||v.jokerCount<0||v.jokerCount>30
   ||typeof v.jokerEnabled!=='boolean'||typeof v.streetModeEnabled!=='boolean'||!['classic','illustrated'].includes(v.boardTheme)||!['classic','xl'].includes(v.layoutMode))return null;
 return v;
}
const BARIKADE_COLORS=['red','blue','green','yellow'];
const BARIKADE_DEFAULTS=Object.freeze({mode:'classic',bossMode:false,boardTheme:'wood',jokerStartCount:3,eventFieldCount:8,bossEventTrigger:2,colorMode:'manual'});
function gameSettings(raw){
 const a=Object.fromEntries(Object.keys(BARIKADE_DEFAULTS).map(k=>[k,raw?.[k]??BARIKADE_DEFAULTS[k]]));
 if(!['classic','action'].includes(a.mode)||typeof a.bossMode!=='boolean'||!['wood','classic','stone'].includes(a.boardTheme)
   ||!Number.isInteger(a.jokerStartCount)||a.jokerStartCount<1||a.jokerStartCount>5
   ||!Number.isInteger(a.eventFieldCount)||a.eventFieldCount<5||a.eventFieldCount>20
   ||!Number.isInteger(a.bossEventTrigger)||a.bossEventTrigger<0||a.bossEventTrigger>10
   ||!['manual','wheel'].includes(a.colorMode))return null;
 return a;
}
const TTL_MS=24*60*60*1000;
const cleanName=n=>String(n||'Spieler').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,24)||'Spieler';
const codeNew=()=>Array.from({length:6},()=>CHARSET[randomInt(CHARSET.length)]).join('');

export function installSharedLobby(app,{verifyProfile,getFirestore,clock=()=>Date.now(),codeGenerator=codeNew,isMatchFinished=async()=>false,bootstrapSkyjo=null,challengeRandomInt=randomInt}){
  const db=()=>{try{return getFirestore()||null;}catch{return null;}};
  const error=(status,message)=>Object.assign(new Error(message),{status});
  const documentFor=(store,code)=>store.collection(COLLECTION).doc(code);
  const validCode=s=>typeof s==='string'&&CODE_PATTERN.test(s.toUpperCase())?s.toUpperCase():null;
  async function authentication(req,res,next){
    if(!db())return res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});
    const authorization=String(req.get('authorization')||'');
    const token=/^Bearer (\S+)$/i.exec(authorization)?.[1];
    if(!token)return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});
    // Express 4 does not automatically capture rejected async middleware.
    // Invalid/expired Firebase tokens must never cause an unhandled rejection.
    let profile;
    try{profile=await verifyProfile(token);}
    catch(_e){return res.status(401).json({ok:false,error:'LOGIN_REQUIRED'});}
    if(!profile?.uid)return res.status(401).json({ok:false,error:'PROFILE_REQUIRED'});
    req.hubIdentity={uid:profile.uid,name:cleanName(profile.name)};
    next();
  }
  function activeSeats(room){return room.players.filter(p=>p.participating);}
  function allReady(room){const game=HUB_GAMES[room.game];const seats=activeSeats(room);return !!game&&seats.length>=game.min&&seats.length<=game.max&&seats.every(p=>p.ready);}
  function gameCodeFor(room,prefix,next){
    const suffix=CHARSET[Math.floor((next-1)/(CHARSET.length**2))%CHARSET.length]
      +CHARSET[Math.floor((next-1)/CHARSET.length)%CHARSET.length]
      +CHARSET[(next-1)%CHARSET.length];
    return prefix+room.code+suffix;
  }
  function startBarikade(room){
    if(room.game!=='barikade')throw error(409,'GAME_NOT_CONNECTED');
    if(!room.players.some(p=>p.uid===room.hostUid&&p.participating))throw error(409,'HOST_MUST_PLAY');
    const seats=activeSeats(room);
    const settings=gameSettings(room.settings?.barikade);
    if(!settings)throw error(409,'INVALID_SETTINGS');
    const next=(Number(room.matchSerial)||0)+1;
    if(next>CHARSET.length**3)throw error(409,'MATCH_LIMIT_REACHED');
    room.matchSerial=next;
    // The internal Barikade engine has a 10-character limit on room codes.
    const gameCode=gameCodeFor(room,'B',next);
    const chosen=new Map(),remaining=[...BARIKADE_COLORS];
    if(settings.colorMode==='wheel'){
      for(let i=remaining.length-1;i>0;i--){const j=randomInt(i+1);[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
    }else{
      for(const p of seats){
        const wanted=String(p.colorPref||'');
        if(BARIKADE_COLORS.includes(wanted)&&remaining.includes(wanted)){
          chosen.set(p.uid,wanted);remaining.splice(remaining.indexOf(wanted),1);
        }
      }
    }
    room.match={id:randomUUID(),game:'barikade',gameCode,startedAt:clock(),settings,
      members:seats.map(p=>({uid:p.uid,seat:p.seat,color:chosen.get(p.uid)||remaining.shift()}))};
    room.phase='playing';
  }
  function startKreuz(room){
    if(room.game!=='kreuz')throw error(409,'GAME_NOT_CONNECTED');
    if(!room.players.some(p=>p.uid===room.hostUid&&p.participating))throw error(409,'HOST_MUST_PLAY');
    const seats=activeSeats(room);
    const next=(Number(room.matchSerial)||0)+1;
    if(next>CHARSET.length**3)throw error(409,'MATCH_LIMIT_REACHED');
    room.matchSerial=next;
    room.match={id:randomUUID(),game:'kreuz',gameCode:gameCodeFor(room,'K',next),startedAt:clock(),
      members:seats.map(p=>({uid:p.uid,name:p.name,seat:p.seat}))};
    room.phase='playing';
  }
  function startSkyjo(room){
    if(room.game!=='skyjo')throw error(409,'GAME_NOT_CONNECTED');
    if(!room.players.some(p=>p.uid===room.hostUid&&p.participating))throw error(409,'HOST_MUST_PLAY');
    const settings=skyjoSettings(room.settings?.skyjo);
    if(!settings)throw error(409,'INVALID_SETTINGS');
    const next=(Number(room.matchSerial)||0)+1;
    if(next>CHARSET.length**3)throw error(409,'MATCH_LIMIT_REACHED');
    room.matchSerial=next;
    room.match={id:randomUUID(),game:'skyjo',gameCode:gameCodeFor(room,'S',next),startedAt:clock(),settings,
      members:activeSeats(room).map(p=>({uid:p.uid,name:p.name,seat:p.seat}))};
    room.phase='playing';
  }
  function startBusiness(room){
    if(room.game!=='business')throw error(409,'GAME_NOT_CONNECTED');
    if(!room.players.some(p=>p.uid===room.hostUid&&p.participating))throw error(409,'HOST_MUST_PLAY');
    const settings=businessSettings(room.settings?.business);
    if(!settings)throw error(409,'INVALID_SETTINGS');
    const next=(Number(room.matchSerial)||0)+1;
    if(next>CHARSET.length**3)throw error(409,'MATCH_LIMIT_REACHED');
    room.matchSerial=next;
    room.match={id:randomUUID(),game:'business',gameCode:gameCodeFor(room,'D',next),startedAt:clock(),settings,
      members:uniqueBusinessNames(activeSeats(room).map(p=>({uid:p.uid,name:p.name,seat:p.seat})))};
    room.phase='playing';
  }
  function setupRecheninsel(ch,round=1){
    let a,b,operator,answer;
    if(round===1){a=3+challengeRandomInt(28);b=2+challengeRandomInt(24);operator=challengeRandomInt(2)?'−':'+';answer=operator==='+'?a+b:a-b;if(answer<0){operator='+';answer=a+b;}}
    else if(round===2){const op=challengeRandomInt(3);if(op===0){a=14+challengeRandomInt(86);b=12+challengeRandomInt(74);operator='+';answer=a+b;}else if(op===1){a=35+challengeRandomInt(96);b=11+challengeRandomInt(a-11);operator='−';answer=a-b;}else{a=3+challengeRandomInt(10);b=3+challengeRandomInt(10);operator='×';answer=a*b;}}
    else{const op=challengeRandomInt(4);if(op===0){a=12+challengeRandomInt(18);b=4+challengeRandomInt(9);operator='×';answer=a*b;}else if(op===1){b=4+challengeRandomInt(12);answer=6+challengeRandomInt(14);a=b*answer;operator='÷';}else if(op===2){a=40+challengeRandomInt(141);b=20+challengeRandomInt(81);operator='+';answer=a+b;}else{a=100+challengeRandomInt(181);b=30+challengeRandomInt(a-30);operator='−';answer=a-b;}}
    ch.math={index:ch.index,round,a,b,operator,answer,answers:{}};
  }
  function setupHuetchen(ch,round=1){
 const n=round+2,moves=[],secret=0;let slot=secret;
 for(let i=0;i<[8,13,19][round-1];i++){const a=challengeRandomInt(n);let b=challengeRandomInt(n-1);if(b>=a)b++;moves.push([a,b]);if(slot===a)slot=b;else if(slot===b)slot=a;}
 ch.huetchen={index:ch.index,round,secret,swaps:moves,correctSlot:slot,answers:{},history:[]};
 }
 function resolveHuetchen(ch,members){
 const h=ch.huetchen;if(ch.phase!=='countdown'||!members.every(p=>Object.hasOwn(h.answers,p.uid)))return;
 const entries=members.map((p,i)=>({seat:p.seat,name:p.name,correct:h.answers[p.uid].slot===h.correctSlot,challengePoints:h.answers[p.uid].slot===h.correctSlot?10:0}));
 members.forEach((p,i)=>ch.points[i]+=entries[i].challengePoints);
 h.history.push({round:h.round,entries});
 if(h.round<3){const history=h.history;setupHuetchen(ch,h.round+1);ch.huetchen.history=history;ch.startAt=clock()+3000;}
 else{ch.results.push({game:'huetchen-challenge',index:ch.index,rounds:h.history,standings:members.map((p,i)=>({seat:p.seat,name:p.name,challengePoints:h.history.reduce((sum,r)=>sum+r.entries[i].challengePoints,0)})),finishedAt:clock()});ch.phase=ch.index===ch.order.length-1?'finished':'results';}
 }
  function setupMaulwurf(ch){ch.maulwurf={index:ch.index,events:Array.from({length:30},(_,tick)=>({tick,hole:challengeRandomInt(9),kind:['bad','gold','normal','normal','normal','normal'][challengeRandomInt(6)]})),hits:{}};}
  function finishMaulwurf(ch,members){const standings=members.map(p=>{const hits=ch.maulwurf.hits[p.uid]||{};const score=Object.values(hits).reduce((sum,kind)=>sum+(kind==='gold'?3:kind==='bad'?-2:1),0);return {seat:p.seat,name:p.name,score,challengePoints:Math.max(0,score)*10};});standings.forEach((p,i)=>ch.points[i]+=p.challengePoints);ch.results.push({game:'maulwurf-arena',index:ch.index,standings,finishedAt:clock()});ch.phase=ch.index===ch.order.length-1?'finished':'results';}
  function setupLava(ch,members){
    ch.lava={index:ch.index,tiles:Array.from({length:100},()=>({state:0,damage:0})),
      players:Object.fromEntries(members.map((m,i)=>[m.uid,{seat:m.seat,x:[90,510,510,90][i],y:[90,510,90,510][i],alive:true,jump:0,seq:0,lastAt:0,deathAt:null}]))};
  }
  function finishLava(ch,members){
    const standings=members.map(m=>{const p=ch.lava.players[m.uid];return {seat:m.seat,name:m.name,alive:p.alive,survivedMs:p.deathAt?Math.max(0,p.deathAt-ch.startAt):90000,challengePoints:Math.max(0,Math.round((p.deathAt?Math.max(0,p.deathAt-ch.startAt):Math.min(90000,Math.max(0,clock()-ch.startAt)))/1000))};});
    standings.forEach((p,i)=>ch.points[i]+=p.challengePoints);
    ch.results.push({game:'lava-arena',index:ch.index,standings,finishedAt:clock()});
    ch.phase=ch.index===ch.order.length-1?'finished':'results';
  }
  // Explosions are evaluated on the server using the original 10×10 map.
  function tickBomber(ch,members,now){
    const game=ch.bomber;if(!game||ch.phase!=='countdown')return;
    const processed=new Set(),active=game.bombs.filter(b=>b.placedAt+2100<=now);
    const hits=new Set(),destroyed=new Set(game.destroyed||[]);
    while(active.length){
      const b=active.shift();if(processed.has(b.id))continue;processed.add(b.id);
      const visit=(x,y)=>{const i=y*10+x;hits.add(i);for(const other of game.bombs)if(other.x===x&&other.y===y&&!processed.has(other.id)&&!active.includes(other))active.push(other);return game.crates.includes(i)&&!destroyed.has(i);};
      visit(b.x,b.y);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        for(let step=1;step<=b.range;step++){
          const x=b.x+dx*step,y=b.y+dy*step;if(x<0||x>=10||y<0||y>=10)break;
          if(visit(x,y))break;
        }
      }
    }
    if(processed.size){
      game.bombs=game.bombs.filter(b=>!processed.has(b.id));
      for(const i of hits)if(game.crates.includes(i))destroyed.add(i);
      game.destroyed=[...destroyed];
      game.blasts=[...hits].map(i=>({x:i%10,y:Math.floor(i/10),until:now+550}));
    }
    game.blasts=(game.blasts||[]).filter(f=>f.until>now);
    for(const p of Object.values(game.players)){
      if(!p.alive||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
      if(game.blasts.some(f=>f.x===Math.floor(p.x)&&f.y===Math.floor(p.y))){p.alive=false;p.eliminatedAt=now;}
    }
    if(Object.values(game.players).filter(p=>p.alive).length<=1||now>=ch.startAt+120000)finishBomber(ch,members);
  }
  function setupBomber(ch,members){
    ch.bomber={index:ch.index,players:Object.fromEntries(members.map(m=>[m.uid,{seat:m.seat,x:null,y:null,alive:true,seq:0,eliminatedAt:null,updatedAt:0,bombsPlaced:0}])),bombs:[],blasts:[],crates:[2,3,4,5,6,7,11,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,81,82,83,84,85,86,87,88,92,93,94,95,96,97],destroyed:[],startedAt:ch.startAt};
  }
  function finishBomber(ch,members){
    if(ch.phase!=='countdown')return;
    const states=members.map(m=>({name:m.name,seat:m.seat,...ch.bomber.players[m.uid]}));
    const standings=states.map(p=>({...p,challengePoints:p.alive?100:Math.max(0,Math.min(90,Math.floor((p.eliminatedAt-ch.startAt)/1000)))})).sort((a,b)=>b.challengePoints-a.challengePoints);
    for(const p of standings){const i=members.findIndex(m=>m.seat===p.seat);ch.points[i]+=p.challengePoints;}
    ch.results.push({game:'bomber-strand-arena',index:ch.index,standings,finishedAt:clock()});
    ch.phase=ch.index===ch.order.length-1?'finished':'results';
  }
  // Preisjäger uses the verified original product pack; never expose prices before reveal.
  const PREISJAEGER_PRODUCTS=[{"name":"IKEA SKÅDIS Lochplatte weiß (36 × 56 cm)","price":8,"category":"Haushalt & Wohnen","icon":"🧰","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/skadis-lochplatte-weiss-50320805/"},{"name":"IKEA SKÅDIS Lochplatte weiß (56 × 56 cm)","price":13,"category":"Haushalt & Wohnen","icon":"🧰","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/skadis-lochplatte-weiss-00320803/"},{"name":"IKEA SKÅDIS Lochplatte schwarz (76 × 56 cm)","price":17,"category":"Haushalt & Wohnen","icon":"🧰","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/skadis-lochplatte-schwarz-50534378/"},{"name":"IKEA SKÅDIS Lochplatte freistehend (56 × 37 cm)","price":18,"category":"Haushalt & Wohnen","icon":"🧰","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/skadis-lochplatte-frei-stehend-weiss-00541574/"},{"name":"IKEA SKÅDIS Lochplatte mit Zubehör (Kombination)","price":35,"category":"Haushalt & Wohnen","icon":"🛠️","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/skadis-lochplatte-kombination-s89406365/"},{"name":"IKEA SKÅDIS Lochplatte mit Zubehör weiß (36 × 56 cm)","price":16,"category":"Haushalt & Wohnen","icon":"🛠️","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/skadis-lochplatte-kombination-weiss-s29303898/"},{"name":"IKEA BLÅVINGAD Blauwal-Stofftier (100 cm)","price":29.99,"category":"Lustig & absurd","icon":"🐳","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/kuscheltiere-stofftiere-18740/"},{"name":"IKEA BLÅVINGAD Oktopus-Stofftier gelb (50 cm)","price":17.99,"category":"Lustig & absurd","icon":"🐙","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/kuscheltiere-stofftiere-18740/"},{"name":"IKEA JÄTTESTOR Stoffelefant grau","price":27.99,"category":"Spielzeug & Geschenke","icon":"🐘","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/kuscheltiere-stofftiere-18740/"},{"name":"IKEA SKOGSDUVA Stoffigel beige (21 cm)","price":5.99,"category":"Spielzeug & Geschenke","icon":"🦔","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/kuscheltiere-stofftiere-18740/"},{"name":"IKEA FABLER BJÖRN Stoffbär beige (21 cm)","price":2,"category":"Spielzeug & Geschenke","icon":"🧸","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/kuscheltiere-stofftiere-18740/"},{"name":"LEGO Rosen (40460, 120 Teile)","price":14.99,"category":"Lustig & absurd","icon":"🌹","shop":"LEGO Online-Shop","url":"https://www.lego.com/de-de/product/roses-40460"},{"name":"IKEA BLÅHAJ Stoffhai (100 cm)","price":27.99,"category":"Lustig & absurd","icon":"🦈","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/blahaj-stoffspielzeug-hai-30373588/"},{"name":"LEGO Rosenstrauß (822 Teile)","price":59.99,"category":"Freizeit & Abenteuer","icon":"💐","shop":"LEGO Online-Shop","url":"https://www.lego.com/de-de/themes/botanicals/roses"},{"name":"DECATHLON SUP-Board 900 Explo Touring","price":449.99,"category":"Freizeit & Abenteuer","icon":"🏄","shop":"DECATHLON Deutschland","url":"https://www.decathlon.de/alle-sportarten-a-z/sup/aufblasbares-sup"},{"name":"LEGO Technic Bugatti-Bolide (42151)","price":49.99,"category":"Spielzeug & Geschenke","icon":"🏎️","shop":"LEGO Online-Shop","url":"https://www.lego.com/de-de/product/bugatti-bolide-42151"},{"name":"Apple AirTag (1 Stück, 2. Generation)","price":35,"category":"Technik & Gadgets","icon":"📍","shop":"Apple Deutschland","url":"https://www.apple.com/de/shop/buy-airtag/airtag/1er-pack"},{"name":"Apple AirTag (4er-Pack, 2. Generation)","price":119,"category":"Technik & Gadgets","icon":"📱","shop":"Apple Deutschland","url":"https://www.apple.com/de/shop/buy-airtag/airtag/4er-pack"},{"name":"IKEA LACK Beistelltisch weiß (55 × 55 cm)","price":9.99,"category":"Haushalt & Wohnen","icon":"🪑","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/lack-beistelltisch-weiss-30449908/"},{"name":"IKEA LACK Beistelltisch Eicheneffekt (55 × 55 cm)","price":9.99,"category":"Haushalt & Wohnen","icon":"🪵","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/p/lack-beistelltisch-eicheneff-wlas-70319028/"},{"name":"IKEA LACK Couchtisch weiß (90 × 55 cm)","price":19.99,"category":"Haushalt & Wohnen","icon":"🛋️","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/wohnzimmertische-10705/"},{"name":"IKEA LACK Wandregal braun (110 × 26 cm)","price":12.99,"category":"Haushalt & Wohnen","icon":"🪚","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/lack-serie-09063/"},{"name":"IKEA LACK Wandregal weiß (30 × 26 cm)","price":3.99,"category":"Haushalt & Wohnen","icon":"🖼️","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/lack-serie-09063/"},{"name":"IKEA GLADOM Tabletttisch schwarz (45 × 53 cm)","price":9.99,"category":"Haushalt & Wohnen","icon":"☕","shop":"IKEA Deutschland","url":"https://www.ikea.com/de/de/cat/beistelltische-10717/"}];
  // Exact-model photo references carried over from the original Preisjäger file.
  const PREISJAEGER_VERIFIED_PHOTOS=Object.freeze({
    'IKEA BLÅHAJ Stoffhai (100 cm)':'https://www.ikea.com/us/en/images/products/blahaj-soft-toy-shark__0710175_pe727378_s5.jpg',
    'LEGO Rosen (40460, 120 Teile)':'https://images.thalia.media/-/BF2000-2000/5f928c901cd94af68958230238e05043/lego-botanicals-40460-rosen-set-spielzeug-fuer-maedchen-und-jungen.jpeg'
  });
  function fillPreisjaegerBotAnswers(ch,members){
    const pj=ch.preisjaeger;if(!pj)return;
    // Test players guess from broad product categories, not from the hidden actual price.
    const productForBot=PREISJAEGER_PRODUCTS[pj.productIds[pj.round-1]];
    for(const member of members){
      if(!member.uid.startsWith('testbot:')||Object.hasOwn(pj.answers,member.uid))continue;
      const text=(productForBot.name+' '+productForBot.category).toLowerCase();
      const band=/airtag|tracker/.test(text)?[15,90]:/lego|technic|baustein/.test(text)?[10,180]:/sup|paddle|board/.test(text)?[180,900]:/stoff|plüsch|kuschel/.test(text)?[8,75]:/tisch|regal|lochplatte|wohnen/.test(text)?[7,110]:[10,120];
      pj.answers[member.uid]=Math.round((band[0]+Math.random()*(band[1]-band[0]))*100)/100;
    }
  }
  function setupPreisjaeger(ch,members){
    const pool=PREISJAEGER_PRODUCTS.map((_,i)=>i);
    for(let i=pool.length-1;i>0;i--){const j=challengeRandomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
    // Guarantee at least one genuine curated photo in each three-question match.
    const photographed=pool.filter(i=>PREISJAEGER_VERIFIED_PHOTOS[PREISJAEGER_PRODUCTS[i].name]);
    const selected=photographed.length?[photographed[challengeRandomInt(photographed.length)]]:[];
    for(const i of pool)if(selected.length<3&&!selected.includes(i))selected.push(i);
    for(let i=selected.length-1;i>0;i--){const j=challengeRandomInt(i+1);[selected[i],selected[j]]=[selected[j],selected[i]];}
    ch.preisjaeger={index:ch.index,round:1,productIds:selected,answers:{},history:[],roundStartedAt:ch.startAt};
    fillPreisjaegerBotAnswers(ch,members);
  }
  function preisjaegerScore(guess,price){
    const d=Math.abs(guess-price)/price;
    return d<1e-10?150:d<=.05+1e-10?100:d<=.10+1e-10?80:d<=.20+1e-10?60:d<=.30+1e-10?40:d<=.50+1e-10?20:0;
  }
  function resolvePreisjaeger(ch,members){
    const pj=ch.preisjaeger;if(!pj||ch.phase!=='countdown')return;
    fillPreisjaegerBotAnswers(ch,members);
    if(!members.every(m=>Object.hasOwn(pj.answers,m.uid)))return;
    const product=PREISJAEGER_PRODUCTS[pj.productIds[pj.round-1]];
    const entries=members.map(m=>({seat:m.seat,name:m.name,guess:pj.answers[m.uid],challengePoints:preisjaegerScore(pj.answers[m.uid],product.price)}));
    entries.forEach((entry,i)=>ch.points[i]+=entry.challengePoints);
    pj.history.push({round:pj.round,product:{...product},entries});
    if(pj.round<3){pj.round++;pj.answers={};ch.startAt=clock()+9000;pj.roundStartedAt=ch.startAt;fillPreisjaegerBotAnswers(ch,members);}
    else{ch.results.push({game:'preisjaeger',index:ch.index,rounds:pj.history,standings:members.map((m,i)=>({seat:m.seat,name:m.name,challengePoints:pj.history.reduce((sum,h)=>sum+h.entries[i].challengePoints,0)})),finishedAt:clock()});ch.phase=ch.index===ch.order.length-1?'finished':'results';}
  }
  function setupSnake(ch,members){
    ch.snake={index:ch.index,players:Object.fromEntries(members.map(m=>[m.uid,{seat:m.seat,score:0,survived:0,alive:true,seq:0,updatedAt:0,finished:false}]))};
  }
  function finishSnake(ch,members){
    if(ch.phase!=='countdown')return;
    const standings=members.map(m=>{const p=ch.snake.players[m.uid];return {seat:m.seat,name:m.name,score:p.score,survived:p.survived,alive:p.alive,challengePoints:Math.max(0,Math.floor(p.score/10))};});
    standings.forEach((p,i)=>ch.points[i]+=p.challengePoints);
    ch.results.push({game:'snake-arena',index:ch.index,standings,finishedAt:clock()});
    ch.phase=ch.index===ch.order.length-1?'finished':'results';
  }
  function setupFlusssprung(ch,members){
    ch.flusssprung={index:ch.index,path:Array.from({length:5},()=>challengeRandomInt(6)),players:Object.fromEntries(members.map(p=>[p.uid,{row:-1,falls:0,finishedAt:null,lastMoveAt:0}])),moves:[]};
  }
  function finishFlusssprung(ch,members){
    const standings=members.map(p=>{const state=ch.flusssprung.players[p.uid];const progress=state.row+1;return {seat:p.seat,name:p.name,progress,falls:state.falls,finishedAt:state.finishedAt,challengePoints:state.finishedAt?Math.max(10,100-state.falls*10):progress*10};});
    standings.forEach((p,i)=>ch.points[i]+=p.challengePoints);
    ch.results.push({game:'flusssprung',index:ch.index,standings,finishedAt:clock()});
    ch.phase=ch.index===ch.order.length-1?'finished':'results';
  }
  function startChallenge(room){
    const seats=activeSeats(room);
    if(seats.length<2||seats.length>4)throw error(409,'INVALID_PLAYER_COUNT');
    // Legacy rooms may still carry a saved 5/9-game setting from before those modes were disabled.
    // Use the currently playable game count rather than blocking an otherwise ready room.
    const selected=room.settings?.partychallenge?.selectedGame;
    const single=CHALLENGE_READY_GAMES.includes(selected);
    const count=single?1:CHALLENGE_READY_GAMES.length;
    const order=single?[selected]:[...CHALLENGE_READY_GAMES];
    for(let i=order.length-1;i>0;i--){const j=challengeRandomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}
    room.match={id:randomUUID(),game:'partychallenge',startedAt:clock(),gameCode:null,
      settings:{count,selectedGame:single?selected:null},members:seats.map(p=>({uid:p.uid,seat:p.seat,name:p.name})),
      challenge:{id:randomUUID(),order:order.slice(0,count),index:0,phase:'countdown',startAt:clock()+3000,
        points:seats.map(()=>0),results:[],timeTargets:{},timeStops:{}}};
    if(room.match.challenge.order[0]==='zeitgefuehl')room.match.challenge.timeTargets['0']=10+challengeRandomInt(11);
    if(room.match.challenge.order[0]==='recheninsel')setupRecheninsel(room.match.challenge);
    if(room.match.challenge.order[0]==='huetchen-challenge')setupHuetchen(room.match.challenge);
    if(room.match.challenge.order[0]==='maulwurf-arena')setupMaulwurf(room.match.challenge);
    if(room.match.challenge.order[0]==='flusssprung')setupFlusssprung(room.match.challenge,room.match.members);
    if(room.match.challenge.order[0]==='snake-arena')setupSnake(room.match.challenge,room.match.members);
    if(room.match.challenge.order[0]==='preisjaeger')setupPreisjaeger(room.match.challenge,room.match.members);
    if(room.match.challenge.order[0]==='bomber-strand-arena')setupBomber(room.match.challenge,room.match.members);
    if(room.match.challenge.order[0]==='lava-arena')setupLava(room.match.challenge,room.match.members);
    room.phase='playing';
  }
  function startGame(room){
    if(room.game==='partychallenge')return startChallenge(room);
    if(room.game==='barikade')return startBarikade(room);
    if(room.game==='kreuz')return startKreuz(room);
    if(room.game==='skyjo')return startSkyjo(room);
    if(room.game==='business')return startBusiness(room);
    throw error(409,'GAME_NOT_CONNECTED');
  }
  function publicChallenge(ch,members,identity){
    const {id,order,index,phase,startAt,points,results}=ch;
    return {id,order,index,phase,startAt,points,results,totals:members.map((m,i)=>({seat:m.seat,name:m.name,points:points[i]||0})),targetSeconds:order[index]==='zeitgefuehl'?ch.timeTargets?.[String(index)]:null,stopped:members.filter(p=>Object.hasOwn(ch.timeStops||{},p.uid)).map(p=>p.seat),huetchen:order[index]==='huetchen-challenge'&&ch.huetchen?{round:ch.huetchen.round,secret:ch.huetchen.secret,swaps:ch.huetchen.swaps,answered:members.filter(p=>Object.hasOwn(ch.huetchen.answers,p.uid)).map(p=>p.seat)}:null,bomber:order[index]==='bomber-strand-arena'&&ch.bomber?{players:members.map(m=>({...ch.bomber.players[m.uid],name:m.name})),bombs:ch.bomber.bombs,blasts:ch.bomber.blasts,destroyed:ch.bomber.destroyed}:null,snake:order[index]==='snake-arena'&&ch.snake?{players:members.map(m=>({name:m.name,...ch.snake.players[m.uid]}))}:null,lava:order[index]==='lava-arena'&&ch.lava?{players:members.map(m=>({...ch.lava.players[m.uid],name:m.name})),tiles:ch.lava.tiles}:null,flusssprung:order[index]==='flusssprung'&&ch.flusssprung?{path:ch.flusssprung.path,players:members.map(p=>({seat:p.seat,name:p.name,...ch.flusssprung.players[p.uid]})),moves:ch.flusssprung.moves.slice(-40),moveCount:ch.flusssprung.moves.length}:null,maulwurf:order[index]==='maulwurf-arena'&&ch.maulwurf?{events:ch.maulwurf.events,roundSeconds:30,hitCount:Object.keys(ch.maulwurf.hits[identity.uid]||{}).length,score:Object.values(ch.maulwurf.hits[identity.uid]||{}).reduce((sum,kind)=>sum+(kind==='gold'?3:kind==='bad'?-2:1),0),hitTicks:Object.keys(ch.maulwurf.hits[identity.uid]||{}).map(Number),opponents:members.map(p=>({seat:p.seat,name:p.name,score:Object.values(ch.maulwurf.hits[p.uid]||{}).reduce((sum,kind)=>sum+(kind==='gold'?3:kind==='bad'?-2:1),0),hits:Object.keys(ch.maulwurf.hits[p.uid]||{}).length}))}:null,preisjaeger:order[index]==='preisjaeger'&&ch.preisjaeger?{round:ch.preisjaeger.round,totalRounds:3,product:(()=>{const p=PREISJAEGER_PRODUCTS[ch.preisjaeger.productIds[ch.preisjaeger.round-1]];return {name:p.name,category:p.category,icon:p.icon,shop:p.shop,image:PREISJAEGER_VERIFIED_PHOTOS[p.name]||null};})(),answered:members.filter(m=>Object.hasOwn(ch.preisjaeger.answers,m.uid)).map(m=>m.seat),myGuess:Object.hasOwn(ch.preisjaeger.answers,identity.uid)?ch.preisjaeger.answers[identity.uid]:null,history:ch.preisjaeger.history}:null,math:order[index]==='recheninsel'&&ch.math?{round:ch.math.round||1,totalRounds:3,a:ch.math.a,b:ch.math.b,operator:ch.math.operator,answered:members.filter(p=>Object.hasOwn(ch.math.answers,p.uid)).map(p=>p.seat)}:null};
  }
  function expose(room,identity){
    const game=HUB_GAMES[room.game]||null;
    const seats=room.players.filter(p=>p.participating);
    return {
      code:room.code,revision:room.revision,serverNow:clock(),phase:room.phase,game:room.game,
      lastCompleted:room.lastCompleted?{id:room.lastCompleted.id,game:room.lastCompleted.game,finishedAt:room.lastCompleted.finishedAt,status:room.lastCompleted.status||'finished',statsEligible:room.lastCompleted.statsEligible!==false}:null,
      gameTitle:game?.title||null,minPlayers:game?.min||null,maxPlayers:game?.max||null,
      // Start button stays disabled until a game-specific adapter is implemented.
      canLaunch:!!HUB_GAMES[room.game],
      settings:room.game==='barikade'?gameSettings(room.settings?.barikade):room.game==='skyjo'?skyjoSettings(room.settings?.skyjo):room.game==='business'?businessSettings(room.settings?.business):room.game==='partychallenge'?{count:room.settings?.partychallenge?.selectedGame?1:CHALLENGE_READY_GAMES.length,selectedGame:room.settings?.partychallenge?.selectedGame||null,availableGames:[...CHALLENGE_READY_GAMES]}:null,
      host:room.hostUid===identity.uid,
      players:room.players.map(p=>({seat:p.seat,name:p.name,ready:p.ready,colorPref:p.colorPref||null,participating:!!p.participating,testBot:!!p.testBot,host:p.uid===room.hostUid,me:p.uid===identity.uid})),
      chatEnabled:true,
      chat:(Array.isArray(room.chat)?room.chat:[]).slice(-40).map(m=>({id:m.id,name:m.name,text:m.text,at:m.at})),
      allReady:allReady(room),
      match:room.phase==='playing'&&room.match?{
        id:room.match.id,game:room.match.game,gameCode:room.match.gameCode,settings:room.match.settings,
        challenge:room.match.game==='partychallenge'?publicChallenge(room.match.challenge,room.match.members,identity):null,
        playerCount:room.match.members.length,
        myColor:room.match.members.find(m=>m.uid===identity.uid)?.color||null,
        participating:room.match.members.some(m=>m.uid===identity.uid)
      }:null,
      createdAt:room.createdAt,updatedAt:room.updatedAt,
    };
  }
  // A finished match returns to the same central room; no second room is created.
  function archiveCompletedMatch(room){
    const match=room.match;
    room.lastCompleted={id:match.id,game:match.game,finishedAt:clock()};
    room.phase='lobby';
    room.game=null;
    room.match=null;
    room.players.forEach(p=>{p.ready=false;p.participating=false;p.colorPref=null;});
  }
  function validateRead(room,identity){
    if(!room||room.expiresAt<=clock())throw error(404,'ROOM_NOT_FOUND');
    if(!room.players.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_MEMBER');
  }
  async function mutate(code,identity,change){
    const store=db();if(!store)throw error(503,'DATABASE_UNAVAILABLE');
    const ref=documentFor(store,code);
    const outcome=await store.runTransaction(async tx=>{
      const snap=await tx.get(ref);const room=snap.exists?snap.data():null;
      validateRead(room,identity);
      const result=await change(room);
      if(result?.remove){tx.delete(ref);return result.value;}
      if(result?.unchanged)return expose(room,identity);
      room.revision=(Number(room.revision)||0)+1;
      room.updatedAt=clock();room.expiresAt=clock()+TTL_MS;
      tx.set(ref,room);
      return expose(room,identity);
    });
    return outcome;
  }
  const handler=fn=>async(req,res)=>{
    try{const result=await fn(req);return res.json({ok:true,...result});}
    catch(e){const status=e?.status||500;if(status>=500)console.error('[shared-lobby]',e?.message||e);
      return res.status(status).json({ok:false,error:status===500?'LOBBY_ERROR':e.message});}
  };
  app.get('/api/hub/health',(_req,res)=>res.json({ok:true,phase:'foundation',storage:'firestore',databaseReady:!!db(),games:Object.keys(HUB_GAMES),integratedGames:['barikade','kreuz','skyjo','business'],challengeFoundation:true}));
  app.use('/api/hub/rooms',authentication);
  app.post('/api/hub/rooms',handler(async req=>{
    const identity=req.hubIdentity,store=db();
    for(let attempts=0;attempts<8;attempts++){
      const code=validCode(codeGenerator());if(!code)throw error(500,'ROOM_CODE_ERROR');
      const ref=documentFor(store,code),now=clock();
      const room={code,hostUid:identity.uid,players:[{uid:identity.uid,seat:randomUUID(),name:identity.name,ready:false,participating:false,joinedAt:now}],
        game:null,phase:'lobby',revision:1,createdAt:now,updatedAt:now,expiresAt:now+TTL_MS};
      try{
        await store.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists&&old.data()?.expiresAt>now)throw error(409,'CODE_OCCUPIED');tx.set(ref,room);});
        return {room:expose(room,identity)};
      }catch(e){if(e?.message==='CODE_OCCUPIED'||e?.code===6)continue;throw e;}
    }
    throw error(503,'ROOM_CODE_UNAVAILABLE');
  }));
  app.post('/api/hub/rooms/:code/join',handler(async req=>{
    const identity=req.hubIdentity,code=validCode(req.params.code);
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const store=db(),ref=documentFor(store,code);
    const room=await store.runTransaction(async tx=>{
      const snap=await tx.get(ref),r=snap.exists?snap.data():null;
      if(!r||r.expiresAt<=clock())throw error(404,'ROOM_NOT_FOUND');
      let p=r.players.find(x=>x.uid===identity.uid);
      if(r.phase==='playing'){
        if(!p)throw error(409,'ROOM_ALREADY_PLAYING');
        return r;
      }
      if(!p){if(r.players.length>=6)throw error(409,'ROOM_FULL');
        // A full game may still have spectators in the central room.
        const seatAvailable=!!r.game&&r.players.filter(x=>x.participating).length<HUB_GAMES[r.game].max;
        p={uid:identity.uid,seat:randomUUID(),name:identity.name,ready:false,participating:seatAvailable,joinedAt:clock()};r.players.push(p);
        r.players.forEach(x=>x.ready=false);
      }
      p.name=identity.name;
      r.revision++;r.updatedAt=clock();r.expiresAt=clock()+TTL_MS;
      tx.set(ref,r);return r;
    });
    return {room:expose(room,identity)};
  }));
  app.get('/api/hub/rooms/:code',handler(async req=>{
    const code=validCode(req.params.code);if(!code)throw error(400,'INVALID_ROOM_CODE');
    const store=db();const snap=await documentFor(store,code).get();const room=snap.exists?snap.data():null;
    validateRead(room,req.hubIdentity);return {room:expose(room,req.hubIdentity)};
  }));
  app.post('/api/hub/rooms/:code/select',handler(async req=>{
    const code=validCode(req.params.code),game=req.body?.game,identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(!Object.hasOwn(HUB_GAMES,game))throw error(400,'INVALID_GAME');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase==='playing')throw error(409,'MATCH_IN_PROGRESS');
      if(game!=='partychallenge')room.players=room.players.filter(p=>!p.testBot);
      room.game=game;room.phase='preparing';
      if(game==='barikade')room.settings={...room.settings,barikade:gameSettings(room.settings?.barikade)||{...BARIKADE_DEFAULTS}};
      if(game==='skyjo')room.settings={...room.settings,skyjo:skyjoSettings(room.settings?.skyjo)||{...SKYJO_DEFAULTS}};
      if(game==='business')room.settings={...room.settings,business:businessSettings(room.settings?.business)||{...BUSINESS_DEFAULTS}};
      if(game==='partychallenge')room.settings={...room.settings,partychallenge:{count:CHALLENGE_READY_GAMES.length,selectedGame:null}};
      room.players.forEach((p,i)=>{p.ready=false;p.participating=i<HUB_GAMES[game].max;});
    })};
  }));
  // Host-only virtual seats, limited to Party Challenge preparation.
  app.post('/api/hub/rooms/:code/challenge-test-players',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const enabled=req.body?.enabled;
    if(typeof enabled!=='boolean')throw error(400,'INVALID_TEST_PLAYER_SETTING');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||room.game!=='partychallenge')throw error(409,'CHALLENGE_NOT_PREPARING');
      const active=room.players.filter(p=>p.participating&&!p.testBot).length;
      if(enabled&&active+2>4)throw error(409,'GAME_SEATS_FULL');
      room.players=room.players.filter(p=>!p.testBot);
      if(enabled){
        for(let i=1;i<=2;i++)room.players.push({uid:'testbot:'+room.code+':'+i,seat:randomUUID(),name:'🤖 Testspieler '+i,ready:true,participating:true,testBot:true,joinedAt:clock()});
      }
      room.players.forEach(p=>{p.ready=!!p.testBot;});
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-settings',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,count=req.body?.count,selectedGame=req.body?.selectedGame??null;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(selectedGame!==null&&!CHALLENGE_READY_GAMES.includes(selectedGame))throw error(400,'INVALID_MINIGAME');
    if(count!==(selectedGame?1:CHALLENGE_READY_GAMES.length))throw error(400,'CHALLENGE_GAMES_NOT_READY');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||room.game!=='partychallenge')throw error(409,'NO_CHALLENGE_SETUP');
      if(room.settings?.partychallenge?.selectedGame===selectedGame&&room.settings?.partychallenge?.count===count)return {unchanged:true};
      room.settings={...room.settings,partychallenge:{count,selectedGame}};
      room.players.forEach(p=>p.ready=!!p.testBot);
    })};
  }));
  // Host changes are stored and validated server-side. Any change invalidates readiness.
  app.post('/api/hub/rooms/:code/settings',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const settings=gameSettings(req.body?.settings);
    if(!settings)throw error(400,'INVALID_SETTINGS');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||room.game!=='barikade')throw error(409,'NO_BARIKADE_SETUP');
      room.settings={...room.settings,barikade:settings};
      room.players.forEach(p=>p.ready=false);
    })};
  }));
  app.post('/api/hub/rooms/:code/skyjo-settings',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const settings=skyjoSettings(req.body?.settings);
    if(!settings)throw error(400,'INVALID_SETTINGS');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||room.game!=='skyjo')throw error(409,'NO_SKYJO_SETUP');
      room.settings={...room.settings,skyjo:settings};
      room.players.forEach(p=>p.ready=false);
    })};
  }));
  app.post('/api/hub/rooms/:code/business-settings',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const settings=businessSettings(req.body?.settings);
    if(!settings)throw error(400,'INVALID_SETTINGS');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||room.game!=='business')throw error(409,'NO_BUSINESS_SETUP');
      room.settings={...room.settings,business:settings};
      room.players.forEach(p=>p.ready=false);
    })};
  }));
  // Players choose only their own color, and no two players can reserve the same color.
  app.post('/api/hub/rooms/:code/color',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const color=req.body?.color;
    if(color!==null&&!BARIKADE_COLORS.includes(color))throw error(400,'INVALID_COLOR');
    return {room:await mutate(code,identity,room=>{
      if(room.phase!=='preparing'||room.game!=='barikade')throw error(409,'NO_BARIKADE_SETUP');
      if(room.settings?.barikade?.colorMode!=='manual')throw error(409,'COLORS_BY_WHEEL');
      const me=room.players.find(p=>p.uid===identity.uid);
      if(!me?.participating)throw error(403,'SPECTATOR_CANNOT_SELECT_COLOR');
      if(color&&room.players.some(p=>p.uid!==identity.uid&&p.participating&&p.colorPref===color))throw error(409,'COLOR_TAKEN');
      me.colorPref=color;
      room.players.forEach(p=>p.ready=false);
    })};
  }));
  // Only the host may change seats. Spectators remain room members.
  // Authenticated room chat: Firestore retained and distributed by hub snapshots.
  app.post('/api/hub/rooms/:code/chat',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const raw=req.body?.text;
    if(typeof raw!=='string'||raw.length>320)throw error(400,'INVALID_CHAT_TEXT');
    const content=raw.replace(/[\u0000-\u001f\u007f]/g,' ').trim();
    if(!content||content.length>300)throw error(400,'INVALID_CHAT_TEXT');
    return {room:await mutate(code,identity,room=>{
      const member=room.players.find(p=>p.uid===identity.uid);
      if(!member)throw error(403,'NOT_A_MEMBER');
      const now=clock();
      if(Number.isFinite(member.lastChatAt)&&now-member.lastChatAt<800)throw error(429,'CHAT_TOO_FAST');
      member.lastChatAt=now;
      if(!Array.isArray(room.chat))room.chat=[];
      room.chat=[...room.chat.slice(-39),{id:randomUUID(),name:cleanName(member.name),text:content,at:now}];
    })};
  }));
  app.post('/api/hub/rooms/:code/seats',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    const seat=req.body?.seat,participating=req.body?.participating;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(typeof seat!=='string'||seat.length>80||typeof participating!=='boolean')throw error(400,'INVALID_SEAT');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||!room.game)throw error(409,'NO_GAME_SELECTED');
      const player=room.players.find(p=>p.seat===seat);
      if(player?.testBot)throw error(409,'TEST_PLAYER_MANAGED_SEPARATELY');
      if(!player)throw error(404,'PLAYER_NOT_FOUND');
      if(player.uid===room.hostUid&&!participating)throw error(409,'HOST_MUST_PLAY');
      if(player.participating===participating)return {unchanged:true};
      if(participating&&room.players.filter(p=>p.participating).length>=HUB_GAMES[room.game].max)
        throw error(409,'GAME_SEATS_FULL');
      player.participating=participating;
      if(!participating)player.colorPref=null;
      room.players.forEach(p=>p.ready=false);
    })};
  }));
  app.post('/api/hub/rooms/:code/ready',handler(async req=>{
    const code=validCode(req.params.code),ready=req.body?.ready,identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(typeof ready!=='boolean')throw error(400,'INVALID_READY');
    return {room:await mutate(code,identity,room=>{
      if(room.phase!=='preparing'||!room.game)throw error(409,'NO_GAME_SELECTED');
      const player=room.players.find(p=>p.uid===identity.uid);
      if(!player.participating)throw error(403,'SPECTATOR_CANNOT_READY');
      player.ready=ready;
      // Automatic and atomic: the very last ready confirmation starts exactly one match.
      if(allReady(room)&&HUB_GAMES[room.game]&&room.game!=='partychallenge')startGame(room);
    })};
  }));
  // No fake game launch: the game adapters must be implemented and tested first.
  app.post('/api/hub/rooms/:code/start',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    return {room:await mutate(code,identity,async room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='preparing'||!room.game)throw error(409,'NO_GAME_SELECTED');
      const rule=HUB_GAMES[room.game];
      const active=room.players.filter(p=>p.participating);
      if(active.length<rule.min||active.length>rule.max||!active.every(p=>p.ready))throw error(409,'PLAYERS_NOT_READY');
      // Fallback for the host; normal starts occur automatically after the last ready.
      startGame(room);
    })};
  }));
  // Any authenticated room member can request a completion check. The backend
  // alone decides whether the active game really ended; no client-supplied score
  // or gameOver boolean can finish a match. A match ID prevents stale tabs from
  // finishing a newer game in the same hub. Firestore transactions serialize calls.
  app.post('/api/hub/rooms/:code/sync',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    const matchId=req.body?.matchId;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(typeof matchId!=='string'||!/^[0-9a-f-]{36}$/i.test(matchId))throw error(400,'INVALID_MATCH_ID');
    return {room:await mutate(code,identity,async room=>{
      if(room.phase!=='playing'||!room.match||room.match.id!==matchId)return {unchanged:true};
      if(room.match.game==='partychallenge')return {unchanged:true};
      if(!(await isMatchFinished(room.match)))return {unchanged:true};
      archiveCompletedMatch(room);
    })};
  }));
  // A single server-generated arithmetic question. Never accept a client score.
  app.post('/api/hub/rooms/:code/challenge-math-answer',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const {challengeId,answer}=req.body||{};
    if(typeof challengeId!=='string'||!Number.isInteger(answer)||answer<0||answer>1000)throw error(400,'INVALID_MATH_ANSWER');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
      if(ch.order[ch.index]!=='recheninsel'||ch.phase!=='countdown'||!ch.math||ch.math.index!==ch.index)throw error(409,'WRONG_CHALLENGE_GAME');
      if(clock()<ch.startAt)throw error(409,'GAME_NOT_STARTED');
      if(clock()>=ch.startAt+[18000,16000,15000][Math.min(2,(ch.math.round||1)-1)])throw error(409,'MATH_ROUND_TIME_EXPIRED');
      const member=room.match.members.find(p=>p.uid===identity.uid);
      if(!member)throw error(403,'NOT_A_PARTICIPANT');
      if(Object.hasOwn(ch.math.answers,identity.uid))return {unchanged:true};
      ch.math.answers[identity.uid]={answer,at:clock()};
      for(const bot of room.players.filter(p=>p.testBot&&p.participating)){
        if(!Object.hasOwn(ch.math.answers,bot.uid)){
          const correct=challengeRandomInt(5)!==0;
          ch.math.answers[bot.uid]={answer:correct?ch.math.answer:ch.math.answer+1,at:clock(),bot:true};
        }
      }
      if(room.match.members.every(p=>Object.hasOwn(ch.math.answers,p.uid))){
        const standings=room.match.members.map(p=>({seat:p.seat,name:p.name,correct:ch.math.answers[p.uid].answer===ch.math.answer}));
        standings.forEach(p=>{
          const submission=ch.math.answers[room.match.members.find(m=>m.seat===p.seat).uid];
          const elapsedMs=Math.max(0,submission.at-ch.startAt);
          const limitSeconds=[18,16,15][Math.min(2,(ch.math.round||1)-1)];
          p.elapsedMs=elapsedMs;
          p.challengePoints=p.correct?100+Math.max(0,Math.round((limitSeconds-elapsedMs/1000)*10)):0;
        });
        room.match.members.forEach((p,i)=>ch.points[i]+=standings.find(x=>x.seat===p.seat).challengePoints);
        ch.mathHistory=ch.mathHistory||[];
        ch.mathHistory.push({round:ch.math.round||1,question:ch.math.a+' '+ch.math.operator+' '+ch.math.b,answer:ch.math.answer,standings});
        if((ch.math.round||1)<3){
          setupRecheninsel(ch,(ch.math.round||1)+1);
          ch.startAt=clock()+3000;
        }else{
          const totals=room.match.members.map(p=>({seat:p.seat,name:p.name,correct:ch.mathHistory.every(h=>h.standings.some(x=>x.seat===p.seat&&x.correct)),challengePoints:ch.mathHistory.reduce((sum,h)=>sum+(h.standings.find(x=>x.seat===p.seat)?.challengePoints||0),0)}));
          ch.results.push({game:'recheninsel',index:ch.index,rounds:ch.mathHistory,standings:totals,finishedAt:clock()});
          ch.phase=ch.index===ch.order.length-1?'finished':'results';
        }
      }
    })};
  }));
  // Server-authoritative timeout: clients may request resolution, but cannot choose results.
  app.post('/api/hub/rooms/:code/challenge-math-timeout',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const {challengeId,round}=req.body||{};
    if(typeof challengeId!=='string'||!Number.isInteger(round)||round<1||round>3)throw error(400,'INVALID_MATH_ROUND');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
      if(ch.order[ch.index]!=='recheninsel'||ch.phase!=='countdown'||!ch.math||ch.math.round!==round)return {unchanged:true};
      if(!room.match.members.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
      const duration=[18000,16000,15000][round-1];
      if(clock()<ch.startAt+duration)return {unchanged:true};
      for(const member of room.match.members){
        if(!Object.hasOwn(ch.math.answers,member.uid))ch.math.answers[member.uid]={answer:null,at:ch.startAt+duration,timeout:true};
      }
      const standings=room.match.members.map(p=>{
        const submission=ch.math.answers[p.uid],correct=submission.answer===ch.math.answer;
        const elapsedMs=Math.max(0,submission.at-ch.startAt);
        return {seat:p.seat,name:p.name,correct,elapsedMs,challengePoints:correct?100+Math.max(0,Math.round((duration-elapsedMs)/100)):0};
      });
      room.match.members.forEach((p,i)=>ch.points[i]+=standings[i].challengePoints);
      ch.mathHistory=ch.mathHistory||[];
      ch.mathHistory.push({round:ch.math.round,question:ch.math.a+' '+ch.math.operator+' '+ch.math.b,answer:ch.math.answer,standings});
      if(round<3){setupRecheninsel(ch,round+1);ch.startAt=clock()+3000;}
      else{
        const totals=room.match.members.map(p=>({seat:p.seat,name:p.name,correct:ch.mathHistory.every(h=>h.standings.some(x=>x.seat===p.seat&&x.correct)),challengePoints:ch.mathHistory.reduce((sum,h)=>sum+(h.standings.find(x=>x.seat===p.seat)?.challengePoints||0),0)}));
        ch.results.push({game:'recheninsel',index:ch.index,rounds:ch.mathHistory,standings:totals,finishedAt:clock()});
        ch.phase=ch.index===ch.order.length-1?'finished':'results';
      }
    })};
  }));
  // Server-measured Zeitgefuehl: a stop request contains no client time or score.
  // Each authenticated seat may stop once after the shared start timestamp.
  function resolveZeitgefuehl(ch,members){
    if(members.every(p=>Object.hasOwn(ch.timeStops,p.uid))){
      const target=ch.timeTargets?.[String(ch.index)];
      if(!Number.isInteger(target)||target<10||target>20)throw error(409,'TIME_TARGET_MISSING');
      const standings=members.map(p=>({seat:p.seat,name:p.name,elapsedMs:ch.timeStops[p.uid]-ch.startAt}));
      standings.forEach(p=>{p.deltaMs=Math.abs(p.elapsedMs-target*1000);});
      standings.sort((a,b)=>a.deltaMs-b.deltaMs||a.seat-b.seat);
      const pointsBySeat=new Map();
      for(let i=0;i<standings.length;){let j=i+1;while(j<standings.length&&standings[j].deltaMs===standings[i].deltaMs)j++;
        const awards=[10,7,4,2];const average=awards.slice(i,j).reduce((a,b)=>a+b,0)/(j-i);
        for(let k=i;k<j;k++)pointsBySeat.set(standings[k].seat,average);
        i=j;
      }
      members.forEach((p,i)=>{ch.points[i]+=pointsBySeat.get(p.seat)||0;});
      ch.results.push({game:'zeitgefuehl',index:ch.index,targetSeconds:target,standings:standings.map(p=>({...p,challengePoints:pointsBySeat.get(p.seat)})),finishedAt:clock()});
      ch.phase=ch.index===ch.order.length-1?'finished':'results';
    }
  }
  app.post('/api/hub/rooms/:code/challenge-huetchen-answer',handler(async req=>{
 const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,round,slot}=req.body||{};
 if(!code)throw error(400,'INVALID_ROOM_CODE');
 if(typeof challengeId!=='string'||!Number.isInteger(round)||!Number.isInteger(slot))throw error(400,'INVALID_HUETCHEN_ANSWER');
 return {room:await mutate(code,identity,room=>{
 const ch=room.match?.challenge,h=ch?.huetchen;
 if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
 if(ch.order[ch.index]!=='huetchen-challenge'||ch.phase!=='countdown'||!h||h.index!==ch.index||h.round!==round)throw error(409,'WRONG_HUETCHEN_ROUND');
 const shuffleMs=[7160,7390,7140][round-1];
 if(clock()<ch.startAt+shuffleMs)throw error(409,'HUETCHEN_STILL_SHUFFLING');
 if(clock()>=ch.startAt+shuffleMs+12000)throw error(409,'HUETCHEN_ROUND_TIME_EXPIRED');
 if(slot<0||slot>=round+2)throw error(400,'INVALID_HUETCHEN_SLOT');
 const member=room.match.members.find(p=>p.uid===identity.uid);if(!member)throw error(403,'NOT_A_PARTICIPANT');
 if(Object.hasOwn(h.answers,identity.uid))return {unchanged:true};
 h.answers[identity.uid]={slot,at:clock()};resolveHuetchen(ch,room.match.members);
 })};
 }));
 app.post('/api/hub/rooms/:code/challenge-huetchen-timeout',handler(async req=>{
  const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,round}=req.body||{};
  if(!code)throw error(400,'INVALID_ROOM_CODE');
  if(typeof challengeId!=='string'||!Number.isInteger(round)||round<1||round>3)throw error(400,'INVALID_HUETCHEN_ROUND');
  return {room:await mutate(code,identity,room=>{
   const ch=room.match?.challenge,h=ch?.huetchen;
   if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
   if(ch.order[ch.index]!=='huetchen-challenge'||ch.phase!=='countdown'||!h||h.index!==ch.index||h.round!==round)return {unchanged:true};
   if(!room.match.members.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
   const deadline=ch.startAt+[7160,7390,7140][round-1]+12000;
   if(clock()<deadline)return {unchanged:true};
   for(const member of room.match.members){
    if(!Object.hasOwn(h.answers,member.uid))h.answers[member.uid]={slot:-1,at:deadline,timedOut:true};
   }
   resolveHuetchen(ch,room.match.members);
  })};
 }));
 app.post('/api/hub/rooms/:code/challenge-maulwurf-hit',handler(async req=>{const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,tick,hole}=req.body||{};if(!code||typeof challengeId!=='string'||!Number.isInteger(tick)||tick<0||tick>=30||!Number.isInteger(hole)||hole<0||hole>8)throw error(400,'INVALID_MAULWURF_HIT');return {room:await mutate(code,identity,room=>{const ch=room.match?.challenge,m=ch?.maulwurf;if(room.phase!=='playing'||ch?.id!==challengeId||ch.order[ch.index]!=='maulwurf-arena'||ch.phase!=='countdown'||!m)throw error(409,'WRONG_CHALLENGE_GAME');if(!room.match.members.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');if(clock()<ch.startAt+tick*1000||clock()>=Math.min(ch.startAt+30000,ch.startAt+(tick+1)*1000+350))throw error(409,'MAULWURF_NOT_VISIBLE');if(m.events[tick].hole!==hole)throw error(409,'MAULWURF_WRONG_HOLE');const hits=m.hits[identity.uid]||(m.hits[identity.uid]={});if(Object.hasOwn(hits,tick))return {unchanged:true};hits[tick]=m.events[tick].kind;})};}));
 app.post('/api/hub/rooms/:code/challenge-maulwurf-timeout',handler(async req=>{const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId}=req.body||{};if(!code||typeof challengeId!=='string')throw error(400,'INVALID_CHALLENGE_ID');return {room:await mutate(code,identity,room=>{const ch=room.match?.challenge;if(room.phase!=='playing'||ch?.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');if(!room.match.members.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');if(ch.order[ch.index]!=='maulwurf-arena'||ch.phase!=='countdown')return {unchanged:true};if(clock()<ch.startAt+30000)return {unchanged:true};finishMaulwurf(ch,room.match.members);})};}));
 app.post('/api/hub/rooms/:code/challenge-time-stop',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const challengeId=req.body?.challengeId;
    if(typeof challengeId!=='string')throw error(400,'INVALID_CHALLENGE_ID');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
      if(ch.order[ch.index]!=='zeitgefuehl'||ch.phase!=='countdown')throw error(409,'WRONG_CHALLENGE_GAME');
      if(clock()<ch.startAt)throw error(409,'GAME_NOT_STARTED');
      if(clock()>=ch.startAt+30000)throw error(409,'TIME_ROUND_EXPIRED');
      const member=room.match.members.find(p=>p.uid===identity.uid);
      if(!member)throw error(403,'NOT_A_PARTICIPANT');
      ch.timeStops=ch.timeStops||{};
      if(Object.hasOwn(ch.timeStops,identity.uid))return {unchanged:true};
      ch.timeStops[identity.uid]=Math.min(clock(),ch.startAt+30000);
      const members=room.match.members;
      // Simulated opponents stop independently; no client may set their score.
      const bots=room.players.filter(p=>p.testBot&&p.participating);
      for(const bot of bots){
        if(!Object.hasOwn(ch.timeStops,bot.uid)){
          const target=ch.timeTargets?.[String(ch.index)]||15;
          ch.timeStops[bot.uid]=ch.startAt+Math.max(1000,Math.min(30000,(target*1000)+(challengeRandomInt(7001)-3500)));
        }
      }
      resolveZeitgefuehl(ch,members);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-time-timeout',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const {challengeId}=req.body||{};
    if(typeof challengeId!=='string')throw error(400,'INVALID_CHALLENGE_ID');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
      if(ch.order[ch.index]!=='zeitgefuehl'||ch.phase!=='countdown')return {unchanged:true};
      if(!room.match.members.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
      if(clock()<ch.startAt+30000)return {unchanged:true};
      ch.timeStops=ch.timeStops||{};
      for(const p of room.match.members)if(!Object.hasOwn(ch.timeStops,p.uid))ch.timeStops[p.uid]=ch.startAt+30000;
      resolveZeitgefuehl(ch,room.match.members);
    })};
  }));
    // A result is accepted only through an independently verified game adapter.
  // This endpoint intentionally does not accept client-provided scores.
  app.post('/api/hub/rooms/:code/challenge-result',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const {challengeId,gameId}=req.body||{};
    if(typeof challengeId!=='string'||typeof gameId!=='string')throw error(400,'INVALID_RESULT_REFERENCE');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
      if(ch.order[ch.index]!==gameId)throw error(409,'STALE_GAME_RESULT');
      // Game-specific authoritative validation is required before enabling this route.
      throw error(409,'GAME_RESULT_ADAPTER_REQUIRED');
    })};
  }));
  // The host can advance only after an authoritative minigame adapter has
  // committed a result. No client may skip an active game or fabricate points.
  app.post('/api/hub/rooms/:code/challenge-next',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    const challengeId=req.body?.challengeId;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    if(typeof challengeId!=='string'||!/^[0-9a-f-]{36}$/i.test(challengeId))throw error(400,'INVALID_CHALLENGE_ID');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId)throw error(409,'CHALLENGE_NOT_ACTIVE');
      if(ch.phase!=='results'||ch.results.length!==ch.index+1)throw error(409,'RESULTS_NOT_READY');
      if(ch.index>=ch.order.length-1)throw error(409,'CHALLENGE_ALREADY_COMPLETE');
      ch.index++;
      ch.phase='countdown';
      ch.startAt=clock()+3000;
      ch.timeStops={};
      if(ch.order[ch.index]==='zeitgefuehl')ch.timeTargets[String(ch.index)]=10+challengeRandomInt(11);
      if(ch.order[ch.index]==='recheninsel'){ch.mathHistory=[];setupRecheninsel(ch);}
      if(ch.order[ch.index]==='huetchen-challenge')setupHuetchen(ch);
      if(ch.order[ch.index]==='maulwurf-arena')setupMaulwurf(ch);
      if(ch.order[ch.index]==='flusssprung')setupFlusssprung(ch,room.match.members);
      if(ch.order[ch.index]==='snake-arena')setupSnake(ch,room.match.members);
    if(ch.order[ch.index]==='preisjaeger')setupPreisjaeger(ch,room.match.members);
    if(ch.order[ch.index]==='bomber-strand-arena')setupBomber(ch,room.match.members);
      if(ch.order[ch.index]==='lava-arena')setupLava(ch,room.match.members);
    })};
  }));
  // Host can replay a completed single minigame without changing room or player seats.
  app.post('/api/hub/rooms/:code/challenge-replay',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,challengeId=req.body?.challengeId;
    if(!code||typeof challengeId!=='string')throw error(400,'INVALID_REPLAY');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId||ch.phase!=='finished'||ch.order.length!==1)throw error(409,'REPLAY_NOT_READY');
      const game=ch.order[0],members=room.match.members;
      room.match.challenge={id:randomUUID(),order:[game],index:0,phase:'countdown',startAt:clock()+3500,points:members.map(()=>0),results:[],timeTargets:{},timeStops:{}};
      const next=room.match.challenge;
      if(game==='zeitgefuehl')next.timeTargets['0']=10+challengeRandomInt(11);
      if(game==='recheninsel')setupRecheninsel(next);
      if(game==='huetchen-challenge')setupHuetchen(next);
      if(game==='maulwurf-arena')setupMaulwurf(next);
      if(game==='flusssprung')setupFlusssprung(next,members);
      if(game==='snake-arena')setupSnake(next,members);
      if(game==='preisjaeger')setupPreisjaeger(next,members);
      if(game==='bomber-strand-arena')setupBomber(next,members);
      if(game==='lava-arena')setupLava(next,members);
    })};
  }));
  // Return to the same room's minigame selection; preserve every seat and test player.
  app.post('/api/hub/rooms/:code/challenge-select',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,challengeId=req.body?.challengeId;
    if(!code||typeof challengeId!=='string')throw error(400,'INVALID_SELECTION_RETURN');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||!ch||ch.id!==challengeId||ch.phase!=='finished'||ch.order.length!==1)throw error(409,'SELECTION_NOT_READY');
      room.phase='preparing';room.match=null;room.game='partychallenge';
      room.settings={...room.settings,partychallenge:{count:1,selectedGame:ch.order[0]}};
      room.players.forEach(p=>{p.ready=!!p.testBot;});
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-preisjaeger-timeout',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,round}=req.body||{};
    if(!code||typeof challengeId!=='string'||!Number.isInteger(round))throw error(400,'INVALID_PREISJAEGER_TIMEOUT');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge,pj=ch?.preisjaeger;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='preisjaeger'||!pj||pj.index!==ch.index||pj.round!==round)throw error(409,'WRONG_PREISJAEGER_ROUND');
      if(!room.match.members.some(m=>m.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
      if(clock()<ch.startAt+45000)throw error(409,'PREISJAEGER_TIME_REMAINING');
      for(const m of room.match.members)if(!m.uid.startsWith('testbot:')&&!Object.hasOwn(pj.answers,m.uid))pj.answers[m.uid]=0;
      resolvePreisjaeger(ch,room.match.members);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-preisjaeger-answer',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,round,guess}=req.body||{};
    if(!code||typeof challengeId!=='string'||!Number.isInteger(round)||!Number.isInteger(guess)||guess<1||guess>100000000)throw error(400,'INVALID_PREISJAEGER_ANSWER');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge,pj=ch?.preisjaeger;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='preisjaeger'||!pj||pj.index!==ch.index||pj.round!==round)throw error(409,'WRONG_PREISJAEGER_ROUND');
      if(clock()<ch.startAt)throw error(409,'GAME_NOT_STARTED');
      if(clock()>=ch.startAt+45000)throw error(409,'PREISJAEGER_ROUND_TIME_EXPIRED');
      if(!room.match.members.some(m=>m.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
      if(Object.hasOwn(pj.answers,identity.uid))return {unchanged:true};
      pj.answers[identity.uid]=guess/100;
      resolvePreisjaeger(ch,room.match.members);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-bomber-state',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,seq,x,y,alive,bombsPlaced}=req.body||{};
    if(!code||typeof challengeId!=='string'||!Number.isSafeInteger(seq)||seq<1||![x,y].every(Number.isFinite)||typeof alive!=='boolean'||!Number.isInteger(bombsPlaced)||bombsPlaced<0||bombsPlaced>500)throw error(400,'INVALID_BOMBER_STATE');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge,game=ch?.bomber;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='bomber-strand-arena'||!game||game.index!==ch.index)throw error(409,'WRONG_CHALLENGE_GAME');
      const p=game.players[identity.uid];if(!p)throw error(403,'NOT_A_PARTICIPANT');
      const now=clock();if(now<ch.startAt||now>ch.startAt+122000)throw error(409,'BOMBER_NOT_RUNNING');
      tickBomber(ch,room.match.members,now);
      if(ch.phase!=='countdown'||seq<=p.seq||!p.alive)return {unchanged:true};
      if(x<0||x>10||y<0||y>10)throw error(400,'INVALID_BOMBER_POSITION');
      if(p.updatedAt&&Math.hypot(x-p.x,y-p.y)>Math.max(.6,(now-p.updatedAt)/1000*7+.6))throw error(409,'BOMBER_SPEED_LIMIT');
      p.x=x;p.y=y;p.seq=seq;p.updatedAt=now;p.bombsPlaced=bombsPlaced;
      tickBomber(ch,room.match.members,now);
      // Clientseitige Todesmeldungen sind nicht vertrauenswürdig: nur tickBomber entscheidet über Treffer.
      if(Object.values(game.players).filter(q=>q.alive).length<=1)finishBomber(ch,room.match.members);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-bomber-bomb',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,seq,x,y,range}=req.body||{};
    if(!code||typeof challengeId!=='string'||!Number.isSafeInteger(seq)||seq<1||!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(range)||range<1||range>9||x<0||x>=10||y<0||y>=10)throw error(400,'INVALID_BOMBER_BOMB');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge,game=ch?.bomber;
      if(ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='bomber-strand-arena'||!game)throw error(409,'WRONG_CHALLENGE_GAME');
      const p=game.players[identity.uid];if(!p||!p.alive)throw error(403,'NOT_ACTIVE_PLAYER');
      const now=clock();if(now<ch.startAt||now>ch.startAt+120000)throw error(409,'BOMBER_NOT_RUNNING');
      tickBomber(ch,room.match.members,now);
      if(ch.phase!=='countdown'||seq<=(p.bombSeq||0))return {unchanged:true};
      if(p.x===null||Math.hypot(p.x-(x+.5),p.y-(y+.5))>1.1)throw error(409,'BOMBER_BOMB_DISTANCE');
      const tileIndex=y*10+x;
      if(game.crates.includes(tileIndex)&&!game.destroyed.includes(tileIndex))throw error(409,'BOMBER_BLOCKED_TILE');
      if(game.bombs.some(b=>b.x===x&&b.y===y))throw error(409,'BOMBER_TILE_OCCUPIED');
      if((p.lastBombAt||0)&&now-p.lastBombAt<180)throw error(429,'BOMBER_BOMB_COOLDOWN');
      if(game.bombs.filter(b=>b.seat===p.seat).length>=16)throw error(409,'BOMBER_BOMB_LIMIT');
      p.bombSeq=seq;p.lastBombAt=now;
      game.bombs.push({id:identity.uid+':'+seq,seat:p.seat,x,y,range,placedAt:now});
      if(game.bombs.length>80)game.bombs=game.bombs.slice(-80);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-bomber-timeout',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId}=req.body||{};
    if(!code||typeof challengeId!=='string')throw error(400,'INVALID_BOMBER_TIMEOUT');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='bomber-strand-arena')return {unchanged:true};
      if(!room.match.members.some(m=>m.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
      tickBomber(ch,room.match.members,clock());
      if(clock()<ch.startAt+120000)return {unchanged:true};
      finishBomber(ch,room.match.members);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-snake-state',handler(async req=>{
  const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,seq,score,survived,alive,finished,points,food,dir}=req.body||{};
  if(!code||typeof challengeId!=='string'||!Number.isSafeInteger(seq)||seq<1||!Number.isSafeInteger(score)||score<0||score>50000||!Number.isSafeInteger(survived)||survived<0||survived>2000||typeof alive!=='boolean')throw error(400,'INVALID_SNAKE_STATE');
  return {room:await mutate(code,identity,room=>{
   const ch=room.match?.challenge,game=ch?.snake;
   if(room.phase!=='playing'||room.match?.game!=='partychallenge'||ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='snake-arena'||!game||game.index!==ch.index)throw error(409,'WRONG_CHALLENGE_GAME');
   const now=clock();if(now<ch.startAt||now>ch.startAt+182000)throw error(409,'SNAKE_NOT_RUNNING');
   const p=game.players[identity.uid];if(!p)throw error(403,'NOT_A_PARTICIPANT');
   if(seq<=p.seq||p.finished)return {unchanged:true};
   const maxSteps=Math.floor((now-ch.startAt)/90)+5;
   if(survived>maxSteps||score>survived*50)throw error(409,'SNAKE_SCORE_LIMIT');
   if(score<p.score||survived<p.survived)throw error(409,'SNAKE_NON_MONOTONIC');
   if(points!==undefined){
    if(!Array.isArray(points)||points.length<1||points.length>200||!points.every(v=>v&&Number.isInteger(v.x)&&v.x>=0&&v.x<24&&Number.isInteger(v.y)&&v.y>=0&&v.y<20))throw error(400,'INVALID_SNAKE_BODY');
    if(p.points&&Math.abs(points.length-p.points.length)>Math.max(3,survived-p.survived+1))throw error(409,'SNAKE_BODY_LIMIT');
   }
   if(food!==undefined&&food!==null&&(!Number.isInteger(food.x)||food.x<0||food.x>=24||!Number.isInteger(food.y)||food.y<0||food.y>=20))throw error(400,'INVALID_SNAKE_FOOD');
   if(dir!==undefined&&!['up','down','left','right'].includes(dir))throw error(400,'INVALID_SNAKE_DIRECTION');
   p.seq=seq;p.score=score;p.survived=survived;p.alive=alive;p.updatedAt=now;p.finished=!!finished||!alive;
   if(points)p.points=points;if(food!==undefined)p.food=food;if(dir)p.dir=dir;
   if(Object.values(game.players).every(v=>v.finished))finishSnake(ch,room.match.members);
  })};
 }));
 app.post('/api/hub/rooms/:code/challenge-snake-timeout',handler(async req=>{
  const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId}=req.body||{};
  if(!code||typeof challengeId!=='string')throw error(400,'INVALID_SNAKE_TIMEOUT');
  return {room:await mutate(code,identity,room=>{
   const ch=room.match?.challenge;
   if(ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='snake-arena')return {unchanged:true};
   if(!room.match.members.some(m=>m.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
   if(clock()<ch.startAt+180000)return {unchanged:true};
   finishSnake(ch,room.match.members);
  })};
 }));
 app.post('/api/hub/rooms/:code/challenge-lava-state',handler(async req=>{
   const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,seq,x,y,jump}=req.body||{};
   if(!code||typeof challengeId!=='string'||!Number.isSafeInteger(seq)||seq<1||![x,y,jump].every(Number.isFinite))throw error(400,'INVALID_LAVA_STATE');
   return {room:await mutate(code,identity,room=>{
     const ch=room.match?.challenge,l=ch?.lava;
     if(room.phase!=='playing'||room.match?.game!=='partychallenge'||ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='lava-arena'||!l||l.index!==ch.index)throw error(409,'WRONG_CHALLENGE_GAME');
     if(clock()<ch.startAt||clock()>ch.startAt+92000)throw error(409,'LAVA_NOT_RUNNING');
     const p=l.players[identity.uid];if(!p)throw error(403,'NOT_A_PARTICIPANT');
     if(seq<=p.seq||!p.alive)return {unchanged:true};
     const now=clock(),dt=p.lastAt?Math.min(1,(now-p.lastAt)/1000):.25;
     if(p.lastAt&&now-p.lastAt<65)return {unchanged:true};
     const nx=Math.max(13,Math.min(587,x)),ny=Math.max(13,Math.min(587,y));
     if(p.lastAt&&Math.hypot(nx-p.x,ny-p.y)>190*Math.max(dt,.1)+65)throw error(409,'LAVA_SPEED_LIMIT');
     p.x=nx;p.y=ny;p.jump=Math.max(0,Math.min(1.3,jump));p.seq=seq;p.lastAt=now;
     for(const t of l.tiles)if(t.state===1){const age=Math.max(0,(now-t.touchedAt)/1000);const startElapsed=Math.max(0,(t.touchedAt-ch.startAt)/1000);const duration=Math.max(.78,1.85-startElapsed*.011);t.damage=Math.min(1,age/duration);if(t.damage>=1)t.state=2;}
     const index=Math.floor(ny/60)*10+Math.floor(nx/60),tile=l.tiles[index];
     if(tile&&tile.state===2&&p.jump===0){p.alive=false;p.deathAt=now;}
     if(tile&&tile.state===0&&p.jump===0){tile.state=1;tile.damage=0;tile.touchedAt=now;}
     
     if(l.players&&Object.values(l.players).filter(v=>v.alive).length<=1)finishLava(ch,room.match.members);
   })};
 }));
 app.post('/api/hub/rooms/:code/challenge-lava-timeout',handler(async req=>{
   const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId}=req.body||{};
   if(!code||typeof challengeId!=='string')throw error(400,'INVALID_LAVA_TIMEOUT');
   return {room:await mutate(code,identity,room=>{
     const ch=room.match?.challenge;
     if(ch?.id!==challengeId||ch.order[ch.index]!=='lava-arena'||ch.phase!=='countdown')return {unchanged:true};
     if(!room.match.members.some(m=>m.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
     if(clock()<ch.startAt+90000)return {unchanged:true};
     finishLava(ch,room.match.members);
   })};
 }));
 app.post('/api/hub/rooms/:code/challenge-flusssprung-jump',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId,row,col}=req.body||{};
    if(!code||typeof challengeId!=='string'||!Number.isInteger(row)||!Number.isInteger(col)||row<0||row>=5||col<0||col>=6)throw error(400,'INVALID_FLUSSSPRUNG_JUMP');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge,f=ch?.flusssprung;
      if(room.phase!=='playing'||room.match?.game!=='partychallenge'||ch?.id!==challengeId||ch.phase!=='countdown'||ch.order[ch.index]!=='flusssprung'||!f||f.index!==ch.index)throw error(409,'WRONG_CHALLENGE_GAME');
      const member=room.match.members.find(p=>p.uid===identity.uid);
      if(!member)throw error(403,'NOT_A_PARTICIPANT');
      if(clock()<ch.startAt||clock()>=ch.startAt+60000)throw error(409,'FLUSSSPRUNG_NOT_RUNNING');
      const player=f.players[identity.uid];
      if(player.finishedAt||row!==player.row+1)throw error(409,'FLUSSSPRUNG_INVALID_ROW');
      if(clock()-player.lastMoveAt<550)throw error(409,'FLUSSSPRUNG_TOO_FAST');
      player.lastMoveAt=clock();
      const safe=f.path[row]===col;
      if(safe){player.row=row;if(row===4)player.finishedAt=clock();}
      else{player.row=-1;player.falls++;}
      f.moves.push({seat:member.seat,row,col,safe,at:clock()});
      /* Keep the full 60-second move log; clients receive a bounded tail with a stable sequence. */
      if(room.match.members.every(p=>f.players[p.uid].finishedAt))finishFlusssprung(ch,room.match.members);
    })};
  }));
  app.post('/api/hub/rooms/:code/challenge-flusssprung-timeout',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity,{challengeId}=req.body||{};
    if(!code||typeof challengeId!=='string')throw error(400,'INVALID_FLUSSSPRUNG_TIMEOUT');
    return {room:await mutate(code,identity,room=>{
      const ch=room.match?.challenge;
      if(room.phase!=='playing'||ch?.id!==challengeId||ch.order[ch.index]!=='flusssprung'||ch.phase!=='countdown'||!ch.flusssprung)throw error(409,'WRONG_CHALLENGE_GAME');
      if(!room.match.members.some(p=>p.uid===identity.uid))throw error(403,'NOT_A_PARTICIPANT');
      if(clock()<ch.startAt+60000)throw error(409,'FLUSSSPRUNG_STILL_RUNNING');
      finishFlusssprung(ch,room.match.members);
    })};
  }));
  // Host-controlled cancellation: no winner and no statistical result.
  app.post('/api/hub/rooms/:code/cancel',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    return {room:await mutate(code,identity,room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='playing'||!room.match)throw error(409,'NO_ACTIVE_MATCH');
      const match=room.match;
      room.lastCompleted={id:match.id,game:match.game,finishedAt:clock(),status:'aborted',statsEligible:false};
      room.phase='lobby';
      room.game=null;
      room.match=null;
      room.players.forEach(p=>{p.ready=false;p.participating=false;p.colorPref=null;});
    })};
  }));
  app.post('/api/hub/rooms/:code/finish',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    return {room:await mutate(code,identity,async room=>{
      if(room.hostUid!==identity.uid)throw error(403,'HOST_ONLY');
      if(room.phase!=='playing'||!room.match)throw error(409,'NO_ACTIVE_MATCH');
      if(room.match.game==='partychallenge')throw error(409,'CHALLENGE_RESULTS_REQUIRED');
      if(!(await isMatchFinished(room.match)))throw error(409,'MATCH_NOT_FINISHED');
      archiveCompletedMatch(room);
    })};
  }));
  app.post('/api/hub/rooms/:code/leave',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const result=await mutate(code,identity,room=>{
      if(room.phase==='playing')throw error(409,'MATCH_IN_PROGRESS');
      room.players=room.players.filter(p=>p.uid!==identity.uid);
      if(!room.players.length)return {remove:true,value:{left:true,roomDeleted:true}};
      if(room.hostUid===identity.uid)room.hostUid=room.players[0].uid;
      room.players.forEach(p=>p.ready=false);
    });
    return result?.left?result:{left:true,roomDeleted:false};
  }));
  // Called only for codes reserved for HUB matches. Always re-verify Firebase identity.
  async function barikadeSeat(gameCode,profile){
    if(!HUB_BARIKADE_CODE.test(String(gameCode||'')))return {legacy:true};
    if(!profile?.uid)return {error:'LOGIN_REQUIRED'};
    const hubCode=gameCode.slice(1,7);
    const store=db();if(!store)return {error:'DATABASE_UNAVAILABLE'};
    const snap=await documentFor(store,hubCode).get();
    const room=snap.exists?snap.data():null;
    if(!room||room.phase!=='playing'||room.match?.gameCode!==gameCode||room.match?.game!=='barikade')return {error:'MATCH_NOT_FOUND'};
    const member=room.match.members.find(m=>m.uid===profile.uid);
    if(!member||!room.players.some(p=>p.uid===profile.uid))return {error:'NOT_A_PARTICIPANT'};
    return {hubCode,color:member.color,host:room.hostUid===profile.uid,uid:profile.uid,gameCode,expectedPlayers:room.match.members.length,settings:room.match.settings};
  }
  // KreuzKunter receives its seats from Firestore, not client-chosen names/tokens.
  async function kreuzSeat(gameCode,profile){
    if(!HUB_KREUZ_CODE.test(String(gameCode||'')))return {legacy:true};
    if(!profile?.uid)return {error:'LOGIN_REQUIRED'};
    const store=db();if(!store)return {error:'DATABASE_UNAVAILABLE'};
    const snap=await documentFor(store,gameCode.slice(1,7)).get();
    const room=snap.exists?snap.data():null;
    if(!room||room.expiresAt<=clock()||room.phase!=='playing'||room.match?.gameCode!==gameCode||room.match?.game!=='kreuz')return {error:'MATCH_NOT_FOUND'};
    if(!room.players.some(p=>p.uid===profile.uid))return {error:'NOT_A_MEMBER'};
    if(!room.match.members.some(p=>p.uid===profile.uid))return {error:'NOT_A_PARTICIPANT'};
    return {gameCode,matchId:room.match.id,hubCode:room.code,hostUid:room.hostUid,
      members:room.match.members.map(({uid,name})=>({uid,name}))};
  }
  // Separate game match ID and six-character lobby code. Only participating Firebase users get a SKYJO seat.
  async function skyjoSeat(gameCode,profile){
    if(!HUB_SKYJO_CODE.test(String(gameCode||'')))return {legacy:true};
    if(!profile?.uid)return {error:'LOGIN_REQUIRED'};
    const store=db();if(!store)return {error:'DATABASE_UNAVAILABLE'};
    const snap=await documentFor(store,gameCode.slice(1,7)).get();
    const room=snap.exists?snap.data():null;
    if(!room||room.expiresAt<=clock()||room.phase!=='playing'||room.match?.game!=='skyjo'||room.match.gameCode!==gameCode)
      return {error:'MATCH_NOT_FOUND'};
    const member=room.match.members.find(m=>m.uid===profile.uid);
    if(!member||!room.players.some(p=>p.uid===profile.uid))return {error:'NOT_A_PARTICIPANT'};
    return {gameCode,hubCode:room.code,matchId:room.match.id,uid:profile.uid,
      host:profile.uid===room.hostUid,hostUid:room.hostUid,settings:room.match.settings,
      members:room.match.members.map(m=>({uid:m.uid,name:m.name}))};
  }
  async function businessSeat(gameCode,profile){
    if(!HUB_BUSINESS_CODE.test(String(gameCode||'')))return {legacy:true};
    if(!profile?.uid)return {error:'LOGIN_REQUIRED'};
    const store=db();if(!store)return {error:'DATABASE_UNAVAILABLE'};
    const snap=await documentFor(store,gameCode.slice(1,7)).get();
    const room=snap.exists?snap.data():null;
    if(!room||room.expiresAt<=clock()||room.phase!=='playing'||room.match?.game!=='business'||room.match.gameCode!==gameCode)
      return {error:'MATCH_NOT_FOUND'};
    const member=room.match.members.find(m=>m.uid===profile.uid);
    if(!member||!room.players.some(p=>p.uid===profile.uid))return {error:'NOT_A_PARTICIPANT'};
    return {gameCode,hubCode:room.code,matchId:room.match.id,uid:profile.uid,name:member.name,
      host:profile.uid===room.hostUid,hostUid:room.hostUid,settings:room.match.settings,
      members:room.match.members.map(m=>({uid:m.uid,name:m.name}))};
  }
  app.post('/api/hub/rooms/:code/skyjo-bootstrap',handler(async req=>{
    const code=validCode(req.params.code),identity=req.hubIdentity;
    if(!code)throw error(400,'INVALID_ROOM_CODE');
    const snap=await documentFor(db(),code).get();const room=snap.exists?snap.data():null;
    validateRead(room,identity);
    if(room.phase!=='playing'||room.match?.game!=='skyjo')throw error(409,'NO_SKYJO_MATCH');
    const seat=await skyjoSeat(room.match.gameCode,identity);
    if(seat.error)throw error(403,seat.error);
    if(req.body?.matchId!==room.match.id)throw error(409,'WRONG_MATCH');
    if(typeof bootstrapSkyjo!=='function')throw error(503,'SKYJO_UNAVAILABLE');
    const data=await bootstrapSkyjo(seat);
    if(!data?.ok)throw error(503,'SKYJO_BOOTSTRAP_FAILED');
    return {gameCode:seat.gameCode,matchId:seat.matchId,hubCode:code,
      seatId:'hub_'+seat.uid,host:seat.host,settings:seat.settings,roomState:data.state,rev:data.rev};
  }));
  // A Firestore snapshot sends each hub update to every authorized player.
  // This does not maintain a second authoritative in-memory room state.
  function attachSocket(ws){
    let unwatch=null,closed=false,authenticated=false;
    const send=payload=>{if(ws.readyState===1)try{ws.send(JSON.stringify(payload));}catch(_e){}};
    const teardown=()=>{closed=true;try{unwatch?.();}catch(_e){}unwatch=null;clearTimeout(authTimeout);clearTimeout(renewTimeout);};
    const authTimeout=setTimeout(()=>{if(!authenticated)try{ws.close(4003,'HUB_AUTH_TIMEOUT');}catch(_e){}},12000);
    const renewTimeout=setTimeout(()=>{try{ws.close(4001,'HUB_TOKEN_RENEW');}catch(_e){}},50*60*1000);
    ws.on('message',async bytes=>{
      if(closed)return;
      if(String(bytes).length>9000){try{ws.close(1009,'HUB_MESSAGE_TOO_LARGE');}catch(_e){}return;}
      let msg;try{msg=JSON.parse(String(bytes));}catch(_e){return;}
      if(msg?.type==='ping'){send({type:'pong'});return;}
      if(msg?.type!=='subscribe'||authenticated)return;
      authenticated=true;
      const code=validCode(msg.code),token=String(msg.profileIdToken||'');
      if(!code||token.length>8500){send({type:'error',error:'INVALID_SUBSCRIPTION'});try{ws.close(4003);}catch(_e){}return;}
      try{
        const identity=await verifyProfile(token);
        if(!identity?.uid)throw error(401,'LOGIN_REQUIRED');
        const store=db();if(!store)throw error(503,'DATABASE_UNAVAILABLE');
        const ref=documentFor(store,code);
        if(closed)return;
        // The initial onSnapshot event already reads the document and checks membership.
        // Avoid a redundant get() on every WebSocket (re)subscription.
        if(typeof ref.onSnapshot!=='function')throw error(503,'REALTIME_UNAVAILABLE');
        unwatch=ref.onSnapshot(next=>{
          try{
            const room=next.exists?next.data():null;
            validateRead(room,identity);
            send({type:'room',room:expose(room,identity)});
          }catch(_e){send({type:'error',error:'NOT_A_MEMBER'});try{ws.close(4003);}catch(_e){}}
        },()=>{send({type:'error',error:'STREAM_UNAVAILABLE'});try{ws.close(1011);}catch(_e){}});
      }catch(e){send({type:'error',error:e?.message||'STREAM_UNAVAILABLE'});try{ws.close(4003);}catch(_e){}}
    });
    ws.on('close',teardown);ws.on('error',teardown);
  }
  return {collection:COLLECTION,games:HUB_GAMES,barikadeSeat,kreuzSeat,skyjoSeat,businessSeat,attachSocket};
}
