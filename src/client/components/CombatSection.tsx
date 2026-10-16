import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Coins, Info, Pause, Play, Sparkles, Swords, Zap } from 'lucide-react';
import type { CombatAction, CombatArenaProfile, CombatArenaResult, CombatCommand, CombatEnemy, CombatGear, CombatGearSlot, CombatIntent, CombatOrbRoll, CombatPage, CombatSkillDefinition, CombatSnapshot, CombatState, CombatStats, CombatTactic } from '../../shared/combat.js';
import { COMBAT_SKILLS, SKILL_RANK_CAP, skillPullCost, undercryptOrbLuckMultiplier, undercryptWardensDefeated } from '../../shared/combat.js';

interface Props { page: CombatPage; onNavigate:(page:CombatPage)=>void; }
interface ApiResponse extends CombatSnapshot {
  actions?:CombatAction[]; defeated?:boolean; died?:boolean; item?:CombatGear; orbRoll?:CombatOrbRoll;
  skillRoll?:{id:string;name:string;rarity:string;rank:number;duplicate:boolean;convertedCoins:number}; cost?:number;
  arenaResult?:CombatArenaResult;
}
async function request<T>(url:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(typeof data.error==='string'?data.error:'Combat request failed.');
  return data as T;
}
const fmt=(n:number)=>Math.max(0,Math.floor(n||0)).toLocaleString();
const percent=(n:number)=>(n*100).toFixed(1)+'%';
const rarityClass=(rarity:string)=>'io-rarity-'+rarity.toLowerCase();
const rankOf=(state:CombatState,id:string)=>Math.max(0,Math.min(SKILL_RANK_CAP,Math.floor(Number(state.skillLevels[id as keyof typeof state.skillLevels])||0)));
const GEAR_SLOTS:{slot:CombatGearSlot;label:string}[]=[
  {slot:'weapon',label:'Weapon'},{slot:'helmet',label:'Helmet'},{slot:'chest',label:'Chest'},{slot:'gloves',label:'Gloves'},
  {slot:'boots',label:'Boots'},{slot:'ring',label:'Ring'},{slot:'amulet',label:'Amulet'},
];
const slotLabel=(slot:CombatGearSlot)=>GEAR_SLOTS.find(entry=>entry.slot===slot)?.label??slot;
const equipped=(state:CombatState,slot:CombatGearSlot)=>state.inventory.find(item=>item.id===state.equipment[slot]&&item.slot===slot)??null;
function skillValue(skill:CombatSkillDefinition,rank:number):string {
  const amount=skill.value*rank;
  return skill.stat==='speedFlat'?'+'+fmt(amount)+' Speed':skill.stat==='critChance'?'+'+(amount*100).toFixed(1)+' percentage points critical chance':'+'+(amount*100).toFixed(1)+'% '+(skill.stat==='damagePct'?'damage':skill.stat==='healthPct'?'max HP':'Delver Coins');
}
function GearCard({item,isEquipped,onEquip,busy}:{item:CombatGear;isEquipped:boolean;onEquip:()=>void;busy:boolean}) {
  const [showTooltip,setShowTooltip]=useState(false);
  const grade=item.quality>=90?'Mythic':item.quality>=70?'Epic':item.quality>=40?'Rare':item.quality>=15?'Uncommon':'Common';
  const bonuses=[
    item.damageBonus>0?{label:'+'+fmt(item.damageBonus)+' DMG',detail:'Adds this amount to base damage'}:null,
    item.speedBonus>0?{label:'+'+fmt(item.speedBonus)+' SPD',detail:'Advances turn frequency'}:null,
    item.maxHealthBonus>0?{label:'+'+fmt(item.maxHealthBonus)+' MAX HP',detail:'Increases maximum health'}:null,
    item.armorBonus>0?{label:'+'+fmt(item.armorBonus)+' ARMOR',detail:'Reduces incoming damage'}:null,
    item.critChanceBonus>0?{label:'+'+(item.critChanceBonus*100).toLocaleString('en-US',{maximumFractionDigits:1})+'% CRIT',detail:'Adds critical-hit chance'}:null,
  ].filter((entry):entry is {label:string;detail:string}=>Boolean(entry));
  return <article tabIndex={0} className={'io-combat-gear-card '+rarityClass(grade)}>
    <div className="io-combat-gear-head"><div><span className="io-combat-eyebrow">{item.quality.toFixed(0)}% · F{fmt(item.floor)} · {slotLabel(item.slot).toUpperCase()}</span><h3>{item.name}</h3></div><div className="io-combat-gear-actions"><span className="io-combat-power">PWR {fmt(item.power)}</span><button type="button" className="io-combat-inspect-button" onClick={()=>setShowTooltip(value=>!value)} aria-expanded={showTooltip} aria-label={'Inspect '+item.name}><Info size={12}/> Details</button></div></div>
    <p>{item.effect}</p>
    <div className="io-combat-gear-stats">{bonuses.map(stat=><span key={stat.label} title={stat.detail}>{stat.label}</span>)}</div>
    {item.majorAbility&&<div className="io-combat-major-ability"><span>✦ MAJOR ABILITY</span><strong>{item.majorAbility.name}</strong><p>{item.majorAbility.description}</p></div>}
    <div className={'io-combat-gear-tooltip '+(showTooltip?'is-open':'')} role="tooltip">
      <span className="io-combat-eyebrow">{grade.toUpperCase()} ITEM · {item.quality.toFixed(0)}% QUALITY · FLOOR {fmt(item.floor)}</span>
      <strong>{item.name}</strong><p>{slotLabel(item.slot)} · Power {fmt(item.power)}</p>
      <div>{bonuses.length?bonuses.map(stat=><span key={stat.label}>{stat.label}</span>):<span>No direct stat bonuses</span>}</div>
      <p>{item.effect}</p>
      {item.majorAbility&&<section><b>✦ {item.majorAbility.name}</b><p>{item.majorAbility.description}</p></section>}
    </div>
    <button type="button" disabled={busy||isEquipped} onClick={onEquip} className={isEquipped?'io-combat-button is-equipped':'io-combat-button'}>{isEquipped?<><Check size={14}/> Equipped</>:'Equip'}</button>
  </article>;
}
export const CombatSection:React.FC<Props>=({page,onNavigate})=>{
  const [state,setState]=useState<CombatState|null>(null);
  const [enemy,setEnemy]=useState<CombatEnemy|null>(null);
  const [stats,setStats]=useState<CombatStats|null>(null);
  const [actions,setActions]=useState<CombatAction[]>([]);
  const [lastOrb,setLastOrb]=useState<CombatOrbRoll|null>(null);
  const [loading,setLoading]=useState(true),[processing,setProcessing]=useState(false),[mutating,setMutating]=useState(false);
  const [auto,setAuto]=useState(true),[paused,setPaused]=useState(false),[intent,setIntent]=useState<CombatIntent>('strike');
  const [showAllSkills,setShowAllSkills]=useState(true);
  const [lastSkill,setLastSkill]=useState<ApiResponse['skillRoll']|null>(null);
  const [error,setError]=useState('');
  const [arenaOpponents,setArenaOpponents]=useState<CombatArenaProfile[]>([]);
  const [arenaSelf,setArenaSelf]=useState<CombatArenaProfile|null>(null);
  const [arenaLoading,setArenaLoading]=useState(false);
  const [arenaResult,setArenaResult]=useState<CombatArenaResult|null>(null);
  const [arenaCooldownMs,setArenaCooldownMs]=useState(0);
  const stateRef=useRef<CombatState|null>(null);
  const runtime=useRef({intent:'strike' as CombatIntent,auto:true,paused:false,busy:false,mutating:false,beatPromise:null as Promise<void>|null,manual:false,pendingIntent:false});
  runtime.current.intent=intent; runtime.current.auto=auto; runtime.current.paused=paused;
  const accept=useCallback((result:CombatSnapshot)=>{
    stateRef.current=result.state;setState(result.state);setEnemy(result.enemy);setStats(result.stats);
  },[]);
  const load=useCallback(async()=>{
    try { const result=await request<CombatSnapshot>('/api/combat/state');accept(result);setError(''); }
    catch(e){setError(e instanceof Error?e.message:'Combat data unavailable.');}
    finally{setLoading(false);}
  },[accept]);
  useEffect(()=>{void load();},[load]);
  const loadArena=useCallback(async()=>{
    setArenaLoading(true);
    try{
      const result=await request<{self:CombatArenaProfile;opponents:CombatArenaProfile[];cooldownRemainingMs:number}>('/api/combat/arena/opponents');
      setArenaSelf(result.self);setArenaOpponents(result.opponents);setArenaCooldownMs(result.cooldownRemainingMs);setError('');
    }catch(e){setError(e instanceof Error?e.message:'Could not load Arena opponents.');}
    finally{setArenaLoading(false);}
  },[]);
  useEffect(()=>{if(page==='arena')void loadArena();},[page,loadArena]);
  useEffect(()=>{if(arenaCooldownMs<=0)return;const timer=window.setInterval(()=>setArenaCooldownMs(ms=>Math.max(0,ms-1000)),1000);return()=>window.clearInterval(timer);},[arenaCooldownMs>0]);
  const challengeArena=async(opponentId:string)=>{
    if(runtime.current.mutating)return;
    runtime.current.mutating=true;setMutating(true);setArenaResult(null);
    try{
      const activeBeat=runtime.current.beatPromise;
      if(activeBeat)await activeBeat;
      const result=await request<ApiResponse>('/api/combat/arena/challenge','POST',{opponentId});
      accept(result);if(result.arenaResult)setArenaResult(result.arenaResult);
      setArenaCooldownMs(90000);setError('');
      await loadArena();
    }catch(e){
      const message=e instanceof Error?e.message:'Arena challenge failed.';
      setError(message);
      if(message.includes('not ready yet'))await loadArena();
    }finally{runtime.current.mutating=false;setMutating(false);}
  };
  const beat=useCallback(async()=>{
    const current=stateRef.current;
    if(!current||runtime.current.busy||runtime.current.mutating||(!runtime.current.manual&&(!runtime.current.auto||runtime.current.paused||Boolean(error))))return;
    const queuedIntent=runtime.current.pendingIntent;
    const beatIntent:CombatCommand=queuedIntent?runtime.current.intent:(runtime.current.auto&&!runtime.current.manual?'auto':runtime.current.intent);
    runtime.current.busy=true;setProcessing(true);
    let releaseBeat!:()=>void;
    const thisBeat=new Promise<void>(resolve=>{releaseBeat=resolve;});
    runtime.current.beatPromise=thisBeat;
    try {
      const result=await request<ApiResponse>('/api/combat/beat','POST',{sequence:current.sequence+1,intent:beatIntent});
      accept(result);if(result.orbRoll)setLastOrb(result.orbRoll);if(result.actions?.length)setActions(old=>[...result.actions!,...old].slice(0,30));
      if(queuedIntent){runtime.current.pendingIntent=false;runtime.current.intent='strike';setIntent('strike');}
      setError('');
    } catch(e) {
      const message=e instanceof Error?e.message:'Combat beat failed.';
      if(message.startsWith('COMBAT_BEAT_TOO_SOON:')) {
        // The server cadence guard can reject a tick that arrives fractionally early.
        // Leave auto-run enabled; the next interval will submit a fresh sequence.
      } else if(message==='stale combat sequence'||message.includes('changed repeatedly'))await load();
      else {setError(message);setAuto(false);}
    } finally {
      runtime.current.busy=false;runtime.current.manual=false;setProcessing(false);
      if(runtime.current.beatPromise===thisBeat)runtime.current.beatPromise=null;
      releaseBeat();
    }
  },[accept,error,load]);
  useEffect(()=>{
    if(!auto||paused||loading||Boolean(error))return;
    const timer=window.setInterval(()=>void beat(),1000);
    return()=>window.clearInterval(timer);
  },[auto,paused,loading,error,beat]);
  const manualBeat=()=>{if(runtime.current.mutating||runtime.current.busy)return;setError('');runtime.current.manual=true;void beat();};
  const mutate=async(url:string,body?:unknown)=>{
    if(runtime.current.mutating)return;
    runtime.current.mutating=true;setMutating(true);
    try {
      const activeBeat=runtime.current.beatPromise;
      if(activeBeat)await activeBeat;
      const result=await request<ApiResponse>(url,'POST',body);accept(result);if(result.skillRoll)setLastSkill(result.skillRoll);if(result.actions?.length)setActions(old=>[...result.actions!,...old].slice(0,30));setError('');
    }
    catch(e){setError(e instanceof Error?e.message:'Combat action failed.');setAuto(false);}
    finally{runtime.current.mutating=false;setMutating(false);}
  };
  if(loading&&!state)return <section className="io-combat-screen"><div className="io-combat-loading">ENTERING THE UNDERCRYPT…</div></section>;
  if(!state||!enemy||!stats)return <section className="io-combat-screen"><header className="io-combat-page-head"><div><span className="io-combat-eyebrow">COMBAT SYSTEM</span><h1>Could not enter the Undercrypt</h1></div></header><p className="io-combat-error">{error||'Combat data unavailable.'}</p><button type="button" className="io-combat-button" onClick={()=>{setLoading(true);void load();}}>Retry</button></section>;


  const ownedSkills=Object.entries(state.skillLevels).filter(([,v])=>Number(v)>0);
  const nextBoss=(Math.floor((state.depth-1)/10)+1)*10;
  const undercryptBestDepth=state.dungeonBestDepths.undercrypt;
  const wardensDefeated=undercryptWardensDefeated(undercryptBestDepth);
  const orbLuckBonusPct=Math.round((undercryptOrbLuckMultiplier(undercryptBestDepth)-1)*100);
  const pullCost=skillPullCost(state.skillRolls);
  const visibleSkills=COMBAT_SKILLS.filter(skill=>showAllSkills||rankOf(state,skill.id)>0);
  const hpPct=Math.max(0,Math.min(100,state.health/Math.max(1,state.maxHealth)*100));
  const enemyPct=Math.max(0,Math.min(100,enemy.hp/Math.max(1,enemy.maxHp)*100));
  return <section className="io-combat-screen">
    <header className="io-combat-page-head"><div><span className="io-combat-eyebrow">INFINITY ORBS · COMBAT EXPANSION</span><h1>{page==='fight'?'Fight':page==='dungeons'?'Dungeons':page==='gear'?'Armory':page==='skills'?'Skill Gacha':'Arena'}</h1><p>{page==='fight'?'Every beat rolls an orb; orb rarity scales your damage while Speed drives initiative. Choose an auto tactic or queue a one-beat command.':page==='dungeons'?'Push deeper into the Undercrypt, discover new rooms and keep permanent rewards when a run ends.':page==='gear'?'Every item has randomized stat affixes. Inspect quality, floor, slot, and rare major abilities before swapping gear.':page==='skills'?'Duplicates rank skills up to Rank 5. Every rank has an explicit numeric effect.':'The Arena will open after the PvE combat rules are stable.'}</p></div><div className="io-combat-run-stamp"><span>RUN {fmt(state.runId)}</span><strong>DEPTH {fmt(state.depth)}</strong><span>BEST {fmt(state.bestDepth)}</span></div></header>
    {error&&<div className="io-combat-error" role="status">{error} <button className="io-combat-text-link" type="button" onClick={()=>{setError('');if(!state)void load();}}>Dismiss / retry</button></div>}

    {page==='fight'&&<>
      <div className="io-combat-stage"><div className="io-combat-stage-top"><span>{enemy.room.toUpperCase()}</span><span>{enemy.kind.toUpperCase()} · {state.dungeonId==='undercrypt'?'NEXT WARDEN':'NEXT BOSS'} {fmt(nextBoss)}</span></div>
        <div className="io-combat-duel">
          <div className="io-combat-combatant io-combat-hero"><div className="io-combat-sprite">∞</div><div className="io-combat-name">DELVER <span>LV {state.level}</span></div><div className="io-combat-hp"><span style={{width:hpPct+'%'}}/></div><small>{fmt(state.health)} / {fmt(state.maxHealth)} HP</small></div>
          <div className="io-combat-versus">VS</div>
          <div className="io-combat-combatant io-combat-foe"><div className="io-combat-sprite">{enemy.emoji}</div><div className="io-combat-name">{enemy.name.toUpperCase()}</div><div className="io-combat-hp is-enemy"><span style={{width:enemyPct+'%'}}/></div><small>{fmt(enemy.hp)} / {fmt(enemy.maxHp)} HP</small></div>
        </div>
        <div className="io-combat-stage-foot"><span><Zap size={14}/> {state.energy}/{state.maxEnergy} ENERGY</span><span>{fmt(stats.speed)} SPD</span><span>{fmt(stats.damage)} BASE DMG</span><span>{percent(stats.critChance)} CRIT</span></div>
      </div>
      <div className={'io-combat-orb-panel '+(lastOrb?'has-orb':'')} aria-live="polite">
        <div className="io-combat-orb-art" style={lastOrb?{background:lastOrb.bgGradient,borderColor:lastOrb.color,color:lastOrb.color,boxShadow:`0 0 26px ${lastOrb.color}66, inset 0 0 12px rgba(255,255,255,.17)`}:undefined}><span>✦</span></div>
        <div className="io-combat-orb-copy"><span className="io-combat-eyebrow">{processing?'ROLLING THIS BEAT':'LAST BEAT ORB'} {lastOrb?'· '+lastOrb.tier.toUpperCase():'· AWAITING FIRST ROLL'}</span><h2>{lastOrb?lastOrb.name:'Every beat rolls an orb'}</h2><p>{lastOrb?'Rarity 1 / '+fmt(lastOrb.rarity)+' · Damage multiplier ×'+lastOrb.damageMultiplier.toFixed(2):'Orb rarity directly scales every attack on the beat.'}</p></div>
        <div className="io-combat-orb-damage"><span>ORB BASE DAMAGE</span><strong>{lastOrb?fmt(lastOrb.baseDamage):'—'}</strong><small>{lastOrb?'before crits and abilities':'not rolled yet'}</small></div>
      </div>
      {(()=>{
        const playerNext=(state.playerActionsResolved+1)*100/Math.max(1,stats.speed);
        const enemyNext=(state.enemyActionsResolved+1)*100/Math.max(1,enemy.speed);
        const playerCharge=Math.round(100*(1-Math.min(1,Math.max(0,playerNext-state.combatBeats))));
        const enemyCharge=Math.round(100*(1-Math.min(1,Math.max(0,enemyNext-state.combatBeats))));
        const events=[
          ...Array.from({length:5},(_,i)=>({actor:'player' as const,time:(state.playerActionsResolved+i+1)*100/Math.max(1,stats.speed),step:i})),
          ...Array.from({length:5},(_,i)=>({actor:'enemy' as const,time:(state.enemyActionsResolved+i+1)*100/Math.max(1,enemy.speed),step:i})),
        ].sort((a,b)=>a.time-b.time).slice(0,7);
        const nextActor=playerNext<=enemyNext?'player':'enemy';
        return <section className="io-combat-turn-tracker" aria-label="Combat speed and turn order">
          <div className="io-combat-turn-head"><div><span className="io-combat-eyebrow">SPEED & INITIATIVE</span><h2>Turn order</h2></div><strong>Next: {nextActor==='player'?'DELVER':enemy.name.toUpperCase()}</strong></div>
          <div className="io-combat-speed-bars">
            <div className="io-combat-speed-row"><span>∞ DELVER <b>{fmt(stats.speed)} SPD</b></span><div className="io-combat-speed-track"><span className="is-player" style={{width:playerCharge+'%'}}/></div><strong>{playerCharge}%</strong></div>
            <div className="io-combat-speed-row"><span>{enemy.emoji} {enemy.name.toUpperCase()} <b>{fmt(enemy.speed)} SPD</b></span><div className="io-combat-speed-track"><span className="is-enemy" style={{width:enemyCharge+'%'}}/></div><strong>{enemyCharge}%</strong></div>
          </div>
          <div className="io-combat-turn-sequence">{events.map((event,index)=><div key={event.actor+'-'+event.step} className={'io-combat-turn-chip '+(index===0?'is-next':'')+(event.actor==='enemy'?' is-foe':'')}><small>{index===0?'NEXT':index===1?'THEN':'+'+(index+1)}</small><strong>{event.actor==='player'?'DELVER':enemy.name}</strong><span>{Math.max(0,event.time-state.combatBeats).toFixed(2)} beats</span></div>)}</div>
        </section>;
      })()}
      <div className="io-combat-tactic-row"><label htmlFor="io-combat-auto-tactic"><span className="io-combat-eyebrow">AUTO TACTIC</span><strong>{state.autoTactic==='balanced'?'Balanced':state.autoTactic==='aggressive'?'Aggressive':state.autoTactic==='defensive'?'Defensive':'Recovery'}</strong></label><select id="io-combat-auto-tactic" value={state.autoTactic} disabled={mutating} onChange={event=>void mutate('/api/combat/tactics',{tactic:event.target.value as CombatTactic})}><option value="balanced">Balanced — heal low, otherwise strike hard</option><option value="aggressive">Aggressive — spend energy on Heavy</option><option value="defensive">Defensive — heal and guard earlier</option><option value="recovery">Recovery — prioritize staying healthy</option></select></div>
      <div className="io-combat-control-row"><div className="io-combat-command-group">{(['strike','heavy','guard','mend'] as CombatIntent[]).map(cmd=><button key={cmd} type="button" onClick={()=>{runtime.current.intent=cmd;runtime.current.pendingIntent=true;setIntent(cmd);}} className={intent===cmd?'io-combat-command is-selected':'io-combat-command'}><span>{cmd==='strike'?'Strike':cmd==='heavy'?'Heavy':cmd==='guard'?'Guard':'Mend'}</span><small>{cmd==='strike'?'FREE':cmd==='heavy'?'3 EN':cmd==='guard'?'2 EN':'4 EN'}</small></button>)}</div><div className="io-combat-run-controls"><button type="button" className="io-combat-button" onClick={()=>setPaused(!paused)}>{paused?<Play size={14}/>:<Pause size={14}/>} {paused?'Resume':'Pause'}</button><button type="button" className="io-combat-button" onClick={()=>setAuto(!auto)}>Auto: {auto?'ON':'OFF'}</button><button type="button" disabled={processing} className="io-combat-button is-secondary" onClick={manualBeat}>{processing?'Resolving…':'Next Beat'}</button></div></div>
      <div className="io-combat-stat-strip"><div><span>DELVER COINS</span><strong>{fmt(state.coins)}</strong></div><div><span>GEAR CARRIED</span><strong>{state.inventory.length}/30</strong></div><div><span>SKILL RANKS</span><strong>{ownedSkills.reduce((n,[,v])=>n+Number(v),0)}</strong></div><div><span>KILLS</span><strong>{fmt(state.totalKills)}</strong></div></div>
      <div className="io-combat-columns"><section className="io-combat-panel"><div className="io-combat-panel-head"><div><span className="io-combat-eyebrow">FIELD NOTES</span><h2>Combat log</h2></div><span>{processing?'RESOLVING':paused?'PAUSED':auto?'AUTO-RUN':'MANUAL'}</span></div><div className="io-combat-log" aria-live="polite">{actions.length?actions.map((a,i)=><p key={state.sequence+'-'+i} className={'io-log-'+a.actor+' io-log-'+a.kind}>{a.text}</p>):<p>The Delver readies a weapon. The first beat is imminent.</p>}</div></section>
        <section className="io-combat-panel"><div className="io-combat-panel-head"><div><span className="io-combat-eyebrow">YOUR LOADOUT</span><h2>Equipped</h2></div><button className="io-combat-text-link" type="button" onClick={()=>onNavigate('gear')}>Armory →</button></div><div className="io-combat-equipped-lines">{GEAR_SLOTS.map(({slot,label})=>{const item=equipped(state,slot);return <div className="io-combat-equipped-line" key={slot}><span>{label.toUpperCase()}</span><strong>{item?.name||'Empty slot'}</strong><small>{item?item.effect:'No item equipped'}</small></div>;})}</div><button className="io-combat-button is-primary" type="button" onClick={()=>onNavigate('skills')}>Open Skill Gacha</button></section></div>
    </>}

    {page==='dungeons'&&<>
      <div className="io-combat-dungeon-choices">
        <div className="io-combat-dungeon-choices-head"><span className="io-combat-eyebrow">CHOOSE YOUR EXPEDITION</span><p>Switching dungeons starts a new run at Depth 1. Each dungeon tracks its own best depth; gear, skills, coins, and levels carry over.</p></div>
        <div className="io-combat-dungeon-choice-grid">
          <article className={'io-combat-dungeon-choice '+(state.dungeonId==='undercrypt'?'is-selected':'')}><span className="io-combat-dungeon-choice-icon">⌁</span><span className="io-combat-eyebrow">BALANCED · STANDARD</span><h3>The Undercrypt</h3><p>Learn the enemy patterns and fight the Crypt Warden. Each cleared Warden grants permanent orb Luck.</p><div className="io-combat-dungeon-choice-best">BEST DEPTH <strong>{fmt(state.dungeonBestDepths.undercrypt)}</strong></div><button type="button" className="io-combat-button is-primary" disabled={mutating||state.dungeonId==='undercrypt'} onClick={()=>void mutate('/api/combat/dungeon',{dungeonId:'undercrypt'})}>{state.dungeonId==='undercrypt'?'Expedition Active':'Enter Undercrypt'}</button></article>
          <article className={'io-combat-dungeon-choice is-cinder '+(state.dungeonId==='cinder-vault'?'is-selected':'')}><span className="io-combat-dungeon-choice-icon">🌋</span><span className="io-combat-eyebrow">HIGH RISK · HIGH PAYOUT</span><h3>The Cinder Vault</h3><p>Enemies have 35% more health and hit 25% harder. Your attacks deal 10% more damage, coins pay 40% more, and weapon/armor drops arrive more often.</p><div className="io-combat-dungeon-choice-best">BEST DEPTH <strong>{fmt(state.dungeonBestDepths['cinder-vault'])}</strong></div><button type="button" className="io-combat-button is-primary" disabled={mutating||state.dungeonId==='cinder-vault'} onClick={()=>void mutate('/api/combat/dungeon',{dungeonId:'cinder-vault'})}>{state.dungeonId==='cinder-vault'?'Expedition Active':'Enter Cinder Vault'}</button></article>
          <article className={'io-combat-dungeon-choice is-glass '+(state.dungeonId==='glass-labyrinth'?'is-selected':'')}><span className="io-combat-dungeon-choice-icon">🔮</span><span className="io-combat-eyebrow">SPEED · PRECISION</span><h3>The Glass Labyrinth</h3><p>Enemies have 22% less health but move 35% faster and hit 12% harder. You gain +35 Speed, +5 percentage points of critical chance, and 25% more combat XP.</p><div className="io-combat-dungeon-choice-best">BEST DEPTH <strong>{fmt(state.dungeonBestDepths['glass-labyrinth'])}</strong></div><button type="button" className="io-combat-button is-primary" disabled={mutating||state.dungeonId==='glass-labyrinth'} onClick={()=>void mutate('/api/combat/dungeon',{dungeonId:'glass-labyrinth'})}>{state.dungeonId==='glass-labyrinth'?'Expedition Active':'Enter Glass Labyrinth'}</button></article>
        </div>
      </div>
      <div className="io-combat-dungeon-hero"><div className="io-combat-dungeon-art"><div className="io-combat-door">{state.dungeonId==='undercrypt'?'⌁':state.dungeonId==='cinder-vault'?'🌋':'🔮'}</div><span>{state.dungeonId==='undercrypt'?'THE UNDERCRYPT':state.dungeonId==='cinder-vault'?'THE CINDER VAULT':'THE GLASS LABYRINTH'}</span><small>ONE WAY DOWN. DEATH SENDS YOU BACK TO THE DOOR.</small></div><div className="io-combat-dungeon-summary"><span className="io-combat-eyebrow">ACTIVE EXPEDITION</span><h2>{state.dungeonId==='undercrypt'?'The Undercrypt':state.dungeonId==='cinder-vault'?'The Cinder Vault':'The Glass Labyrinth'}</h2><p>Enemy types and rooms rotate with depth. Every tenth depth ends in a dungeon-specific boss fight. Auto-combat resumes from the current room while this mode is open.</p><div className="io-combat-dungeon-metrics"><div><span>CURRENT DEPTH</span><strong>{fmt(state.depth)}</strong></div><div><span>PERSONAL BEST</span><strong>{fmt(state.bestDepth)}</strong></div><div><span>{state.dungeonId==='undercrypt'?'NEXT WARDEN':'NEXT BOSS'}</span><strong>{fmt(nextBoss)}</strong></div><div><span>ORB LUCK BONUS</span><strong>+{orbLuckBonusPct}%</strong></div></div><p className="io-combat-resonance-note">{fmt(wardensDefeated)} Crypt Wardens defeated · +1% permanent effective Luck per Warden, capped at +25%. Applies to Infinity Orbs rolls.</p><button type="button" className="io-combat-button is-primary" onClick={()=>onNavigate('fight')}>Return to Fight →</button></div></div>
      <div className="io-combat-panel io-combat-rule-panel"><span className="io-combat-eyebrow">RUN RULES</span><h2>Death is a setback, not a wipe.</h2><p>Health persists between rooms. On death, a new push begins at Depth 1 with full health. Best depth, Delver Coins, levels, skill ranks, and collected gear stay with you.</p><p>Gear quality rolls from 0% to 100%. All seven equipment slots can roll randomized damage, armor, speed, health, and critical affixes. Major abilities are rare: higher quality improves the chance, but never guarantees one.</p><p>Main-game attunement currently grants <b>+{(stats.coreProgressionBonus*100).toFixed(1)}%</b> combat damage and max HP. Every 10 core-game levels grants +2% (capped at +20%); each order of magnitude in your highest orb rarity grants +0.3% (capped at +5%). This refreshes when you enter Combat.</p></div>
    </>}

    {page==='gear'&&<>
      <div className="io-combat-stat-strip"><div><span>BASE DAMAGE</span><strong>{fmt(stats.damage)}</strong></div><div><span>SPEED</span><strong>{fmt(stats.speed)}</strong></div><div><span>ARMOR</span><strong>{fmt(stats.armor)}</strong></div><div><span>CRIT CHANCE</span><strong>{percent(stats.critChance)}</strong></div></div>
      <div className="io-combat-panel"><div className="io-combat-panel-head"><div><span className="io-combat-eyebrow">ACTIVE BUILD</span><h2>Equipment slots</h2></div></div><div className="io-combat-equipped-grid io-combat-equipment-slot-grid">{GEAR_SLOTS.map(({slot,label})=>{const item=equipped(state,slot);return <div className="io-combat-equipped-card" key={slot}><span>{label.toUpperCase()}</span><strong>{item?.name||'Empty slot'}</strong><p>{item?.effect||'No item equipped.'}</p><small>{item?['+'+fmt(item.damageBonus)+' DMG','+'+fmt(item.speedBonus)+' SPD','+'+fmt(item.maxHealthBonus)+' HP','+'+fmt(item.armorBonus)+' ARMOR','+'+(item.critChanceBonus*100).toFixed(1)+'% CRIT'].join(' · '):'Equip an item from your bag.'}</small>{item?.majorAbility&&<p className="io-combat-major-inline">✦ {item.majorAbility.name}: {item.majorAbility.description}</p>}</div>;})}</div></div>
      <div className="io-combat-inventory-head"><div><span className="io-combat-eyebrow">BAG</span><h2>Collected gear</h2></div><span>{state.inventory.length} / 30 · newest first</span></div>
      <div className="io-combat-gear-grid">{state.inventory.map(item=><GearCard key={item.id} item={item} isEquipped={state.equipment[item.slot]===item.id} busy={mutating} onEquip={()=>void mutate('/api/combat/equip',{itemId:item.id})}/>)}</div>
    </>}

    {page==='skills'&&<>
      <div className="io-combat-skill-banner"><div><span className="io-combat-eyebrow">SKILL GACHA</span><h2>Duplicates raise rank. All ranks stack.</h2><p>Five skills in each of five rarities. Pulls cost Delver Coins; each copy adds one rank up to Rank 5.</p></div><div className="io-combat-pull-box"><span><Coins size={15}/> {fmt(state.coins)} DELVER COINS</span><button type="button" className="io-combat-button is-primary" disabled={mutating||state.coins<pullCost} onClick={()=>void mutate('/api/combat/skills/roll')}>{mutating?'Rolling…':'Roll Skill · '+fmt(pullCost)}</button><small>Rates: Common 55% · Uncommon 25% · Rare 12% · Epic 6% · Mythic 2%</small></div></div>
      {lastSkill&&<div className={'io-combat-skill-result '+rarityClass(lastSkill.rarity)}><Sparkles size={18}/><div><strong>{lastSkill.name}</strong><p>{lastSkill.duplicate?'Duplicate pulled. ':'New skill discovered. '}{lastSkill.rank>0?'Now Rank '+lastSkill.rank+'. ':''}{lastSkill.convertedCoins>0?'Rank cap reached; converted to +'+fmt(lastSkill.convertedCoins)+' coins.':''}</p></div><span>{lastSkill.rarity.toUpperCase()}</span></div>}
      <div className="io-combat-codex-toolbar"><div><span className="io-combat-eyebrow">SKILL CODEX</span><h2>{ownedSkills.length} / {COMBAT_SKILLS.length} discovered</h2></div><button type="button" className="io-combat-button is-secondary" onClick={()=>setShowAllSkills(!showAllSkills)}>{showAllSkills?'Owned only':'Show all 25'}</button></div>
      <div className="io-combat-skill-grid">{visibleSkills.map(skill=>{const rank=rankOf(state,skill.id);return <article key={skill.id} className={'io-combat-skill-card '+rarityClass(skill.rarity)}><div className="io-combat-skill-card-head"><span>{skill.rarity.toUpperCase()}</span><b>{rank?'RANK '+rank+'/'+SKILL_RANK_CAP:'NOT OWNED'}</b></div><h3>{skill.name}</h3><p>{skill.effect}</p>{rank>0&&<div className="io-combat-skill-progress"><span style={{width:(rank/SKILL_RANK_CAP*100)+'%'}}/></div>}{rank>0&&<small>Current effect: {skillValue(skill,rank)}</small>}</article>;})}</div>
    </>}

    {page==='arena'&&<>
      <div className="io-combat-arena-head"><div><span className="io-combat-eyebrow">ASYNC PVP · SERVER-RESOLVED</span><h2>Build vs. build</h2><p>Challenge a real player's saved loadout. Both ratings update after the battle; PvE health and dungeon progress are untouched.</p></div>
        <div className="io-combat-arena-rating"><span>YOUR ARENA RATING</span><strong>{fmt(arenaSelf?.rating??state.arenaRating)}</strong><small>{fmt(arenaSelf?.wins??state.arenaWins)} W · {fmt(arenaSelf?.losses??state.arenaLosses)} L</small></div></div>
      {arenaResult&&<section className={'io-combat-arena-result '+(arenaResult.winner==='you'?'is-win':'is-loss')}><div className="io-combat-arena-result-head"><span className="io-combat-eyebrow">{arenaResult.winner==='you'?'VICTORY':'DEFEAT'}</span><strong>{arenaResult.ratingChange>0?'+':''}{arenaResult.ratingChange} Rating</strong><small>vs. {arenaResult.opponent.username} · {fmt(arenaResult.rounds)} rounds</small></div><div className="io-combat-arena-result-log">{arenaResult.log.map((line,index)=><p key={index}>{line}</p>)}</div></section>}
      <div className="io-combat-arena-toolbar"><div><span className="io-combat-eyebrow">RECENT DELVERS</span><h3>{arenaOpponents.length} opponents available</h3></div><button type="button" className="io-combat-button is-secondary" disabled={arenaLoading} onClick={()=>void loadArena()}>{arenaLoading?'Refreshing…':'Refresh list'}</button></div>
      {arenaLoading&&!arenaOpponents.length?<div className="io-combat-loading">SCOUTING THE ARENA…</div>:arenaOpponents.length===0?<div className="io-combat-arena-empty"><Swords size={26}/><h3>No opponents have checked in yet.</h3><p>Other players appear after they open Combat. This list never fills itself with fake accounts.</p></div>:<div className="io-combat-opponent-grid">{arenaOpponents.map(opponent=><article className="io-combat-opponent-card" key={opponent.userId}>
        <div className="io-combat-opponent-head"><div><span className="io-combat-eyebrow">RATING {fmt(opponent.rating)}</span><h3>{opponent.username}</h3></div><span className="io-combat-opponent-record">{fmt(opponent.wins)}W / {fmt(opponent.losses)}L</span></div>
        <div className="io-combat-opponent-stats"><span>LV {opponent.level}</span><span>BEST DEPTH {fmt(opponent.bestDepth)}</span><span>SKILL RANKS {fmt(opponent.skillRanks)}</span></div>
        <div className="io-combat-opponent-build"><p><b>{opponent.weaponName}</b> · {fmt(opponent.damage)} DMG</p><p><b>{opponent.armorName}</b> · {fmt(opponent.maxHealth)} HP</p><p>{fmt(opponent.speed)} SPD · {percent(opponent.critChance)} CRIT</p></div>
        <button type="button" className="io-combat-button is-primary" disabled={mutating||arenaCooldownMs>0} onClick={()=>void challengeArena(opponent.userId)}>{mutating?'Resolving…':arenaCooldownMs>0?'Challenge cooldown':'Challenge player'}</button>
      </article>)}</div>}
      <p className="io-combat-arena-footnote">One challenge every 90 seconds. Rating uses an Elo-style update. Results are computed by the server from each player's saved gear and skill ranks.</p>
    </>}
  </section>;
};
