import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Coins, Pause, Play, Sparkles, Swords, Zap } from 'lucide-react';
import type { CombatAction, CombatEnemy, CombatGear, CombatIntent, CombatPage, CombatSkillDefinition, CombatSnapshot, CombatState, CombatStats } from '../../shared/combat.js';
import { COMBAT_SKILLS, SKILL_RANK_CAP, nextUndercryptWardenDepth, skillPullCost, undercryptOrbLuckMultiplier, undercryptWardensDefeated } from '../../shared/combat.js';

interface Props { page: CombatPage; onNavigate:(page:CombatPage)=>void; }
interface ApiResponse extends CombatSnapshot {
  actions?:CombatAction[]; defeated?:boolean; died?:boolean; item?:CombatGear;
  skillRoll?:{id:string;name:string;rarity:string;rank:number;duplicate:boolean;convertedCoins:number}; cost?:number;
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
const equipped=(state:CombatState,slot:'weapon'|'armor')=>state.inventory.find(item=>item.id===state.equipment[slot]&&item.slot===slot)??null;
function skillValue(skill:CombatSkillDefinition,rank:number):string {
  const amount=skill.value*rank;
  return skill.stat==='speedFlat'?'+'+fmt(amount)+' Speed':skill.stat==='critChance'?'+'+(amount*100).toFixed(1)+' percentage points critical chance':'+'+(amount*100).toFixed(1)+'% '+(skill.stat==='damagePct'?'damage':skill.stat==='healthPct'?'max HP':'Delver Coins');
}
function GearCard({item,isEquipped,onEquip,busy}:{item:CombatGear;isEquipped:boolean;onEquip:()=>void;busy:boolean}) {
  const grade=item.quality>=90?'Mythic':item.quality>=70?'Epic':item.quality>=40?'Rare':item.quality>=15?'Uncommon':'Common';
  return <article className={'io-combat-gear-card '+rarityClass(grade)}>
    <div className="io-combat-gear-head"><div><span className="io-combat-eyebrow">{item.slot==='weapon'?'WEAPON':'ARMOR'} · {item.quality.toFixed(2)}% QUALITY</span><h3>{item.name}</h3></div><span className="io-combat-power">PWR {fmt(item.power)}</span></div>
    <p>{item.effect}</p><div className="io-combat-gear-stats">
      {item.damageBonus>0&&<span>+{fmt(item.damageBonus)} DMG</span>}{item.speedBonus>0&&<span>+{fmt(item.speedBonus)} SPD</span>}{item.maxHealthBonus>0&&<span>+{fmt(item.maxHealthBonus)} MAX HP</span>}
    </div><button type="button" disabled={busy||isEquipped} onClick={onEquip} className={isEquipped?'io-combat-button is-equipped':'io-combat-button'}>{isEquipped?<><Check size={14}/> Equipped</>:'Equip'}</button>
  </article>;
}
export const CombatSection:React.FC<Props>=({page,onNavigate})=>{
  const [state,setState]=useState<CombatState|null>(null);
  const [enemy,setEnemy]=useState<CombatEnemy|null>(null);
  const [stats,setStats]=useState<CombatStats|null>(null);
  const [actions,setActions]=useState<CombatAction[]>([]);
  const [loading,setLoading]=useState(true),[processing,setProcessing]=useState(false),[mutating,setMutating]=useState(false);
  const [auto,setAuto]=useState(true),[paused,setPaused]=useState(false),[intent,setIntent]=useState<CombatIntent>('strike');
  const [showAllSkills,setShowAllSkills]=useState(true);
  const [lastSkill,setLastSkill]=useState<ApiResponse['skillRoll']|null>(null);
  const [error,setError]=useState('');
  const stateRef=useRef<CombatState|null>(null);
  const runtime=useRef({intent:'strike' as CombatIntent,auto:true,paused:false,busy:false,manual:false});
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
  const beat=useCallback(async()=>{
    const current=stateRef.current;
    if(!current||runtime.current.busy||(!runtime.current.manual&&(!runtime.current.auto||runtime.current.paused||Boolean(error))))return;
    runtime.current.busy=true;setProcessing(true);
    try {
      const result=await request<ApiResponse>('/api/combat/beat','POST',{sequence:current.sequence+1,intent:runtime.current.intent});
      accept(result);if(result.actions?.length)setActions(old=>[...result.actions!,...old].slice(0,30));runtime.current.intent='strike';setIntent('strike');setError('');
    } catch(e) {
      const message=e instanceof Error?e.message:'Combat beat failed.';
      if(message==='stale combat sequence'||message.includes('changed repeatedly'))await load();
      else {setError(message);setAuto(false);}
    } finally {runtime.current.busy=false;runtime.current.manual=false;setProcessing(false);}
  },[accept,error,load]);
  useEffect(()=>{
    if(!auto||paused||loading||Boolean(error))return;
    const timer=window.setInterval(()=>void beat(),1000);
    return()=>window.clearInterval(timer);
  },[auto,paused,loading,error,beat]);
  const manualBeat=()=>{setError('');runtime.current.manual=true;void beat();};
  const mutate=async(url:string,body?:unknown)=>{
    setMutating(true);
    try { const result=await request<ApiResponse>(url,'POST',body);accept(result);if(result.skillRoll)setLastSkill(result.skillRoll);if(result.actions?.length)setActions(old=>[...result.actions!,...old].slice(0,30));setError(''); }
    catch(e){setError(e instanceof Error?e.message:'Combat action failed.');setAuto(false);}
    finally{setMutating(false);}
  };
  if(loading&&!state)return <section className="io-combat-screen"><div className="io-combat-loading">ENTERING THE UNDERCRYPT…</div></section>;
  if(!state||!enemy||!stats)return <section className="io-combat-screen"><header className="io-combat-page-head"><div><span className="io-combat-eyebrow">COMBAT SYSTEM</span><h1>Could not enter the Undercrypt</h1></div></header><p className="io-combat-error">{error||'Combat data unavailable.'}</p><button type="button" className="io-combat-button" onClick={()=>{setLoading(true);void load();}}>Retry</button></section>;

  const weapon=equipped(state,'weapon'), armor=equipped(state,'armor');
  const ownedSkills=Object.entries(state.skillLevels).filter(([,v])=>Number(v)>0);
  const nextBoss=nextUndercryptWardenDepth(state.depth);
  const wardensDefeated=undercryptWardensDefeated(state.bestDepth);
  const orbLuckBonusPct=Math.round((undercryptOrbLuckMultiplier(state.bestDepth)-1)*100);
  const pullCost=skillPullCost(state.skillRolls);
  const visibleSkills=COMBAT_SKILLS.filter(skill=>showAllSkills||rankOf(state,skill.id)>0);
  const hpPct=Math.max(0,Math.min(100,state.health/Math.max(1,state.maxHealth)*100));
  const enemyPct=Math.max(0,Math.min(100,enemy.hp/Math.max(1,enemy.maxHp)*100));
  return <section className="io-combat-screen">
    <header className="io-combat-page-head"><div><span className="io-combat-eyebrow">INFINITY ORBS · COMBAT EXPANSION</span><h1>{page==='fight'?'Fight':page==='dungeons'?'Dungeons':page==='gear'?'Armory':page==='skills'?'Skill Gacha':'Arena'}</h1><p>{page==='fight'?'The next beat resolves on the server. Configure a command; your build handles the rest.':page==='dungeons'?'Push deeper into the Undercrypt, discover new rooms and keep permanent rewards when a run ends.':page==='gear'?'Quality is a real stat roll. Compare item effects, not just power.':page==='skills'?'Duplicates rank skills up to Rank 5. Every rank has an explicit numeric effect.':'The Arena will open after the PvE combat rules are stable.'}</p></div><div className="io-combat-run-stamp"><span>RUN {fmt(state.runId)}</span><strong>DEPTH {fmt(state.depth)}</strong><span>BEST {fmt(state.bestDepth)}</span></div></header>
    {error&&<div className="io-combat-error" role="status">{error} <button className="io-combat-text-link" type="button" onClick={()=>{setError('');if(!state)void load();}}>Dismiss / retry</button></div>}

    {page==='fight'&&<>
      <div className="io-combat-stage"><div className="io-combat-stage-top"><span>{enemy.room.toUpperCase()}</span><span>{enemy.kind.toUpperCase()} · {enemy.boss?'CURRENT WARDEN':'NEXT WARDEN'} {fmt(nextBoss)}</span></div>
        <div className="io-combat-duel">
          <div className="io-combat-combatant io-combat-hero"><div className="io-combat-sprite">∞</div><div className="io-combat-name">DELVER <span>LV {state.level}</span></div><div className="io-combat-hp"><span style={{width:hpPct+'%'}}/></div><small>{fmt(state.health)} / {fmt(state.maxHealth)} HP</small></div>
          <div className="io-combat-versus">VS</div>
          <div className="io-combat-combatant io-combat-foe"><div className="io-combat-sprite">{enemy.emoji}</div><div className="io-combat-name">{enemy.name.toUpperCase()}</div><div className="io-combat-hp is-enemy"><span style={{width:enemyPct+'%'}}/></div><small>{fmt(enemy.hp)} / {fmt(enemy.maxHp)} HP</small></div>
        </div>
        <div className="io-combat-stage-foot"><span><Zap size={14}/> {state.energy}/{state.maxEnergy} ENERGY</span><span>{fmt(stats.speed)} SPD</span><span>{fmt(stats.damage)} DMG</span><span>{percent(stats.critChance)} CRIT</span></div>
      </div>
      <div className="io-combat-control-row"><div className="io-combat-command-group">{(['strike','heavy','guard','mend'] as CombatIntent[]).map(cmd=><button key={cmd} type="button" onClick={()=>setIntent(cmd)} className={intent===cmd?'io-combat-command is-selected':'io-combat-command'}><span>{cmd==='strike'?'Strike':cmd==='heavy'?'Heavy':cmd==='guard'?'Guard':'Mend'}</span><small>{cmd==='strike'?'FREE':cmd==='heavy'?'3 EN':cmd==='guard'?'2 EN':'4 EN'}</small></button>)}</div><div className="io-combat-run-controls"><button type="button" className="io-combat-button" onClick={()=>setPaused(!paused)}>{paused?<Play size={14}/>:<Pause size={14}/>} {paused?'Resume':'Pause'}</button><button type="button" className="io-combat-button" onClick={()=>setAuto(!auto)}>Auto: {auto?'ON':'OFF'}</button><button type="button" disabled={processing} className="io-combat-button is-secondary" onClick={manualBeat}>{processing?'Resolving…':'Next Beat'}</button></div></div>
      <div className="io-combat-stat-strip"><div><span>DELVER COINS</span><strong>{fmt(state.coins)}</strong></div><div><span>GEAR CARRIED</span><strong>{state.inventory.length}/30</strong></div><div><span>SKILL RANKS</span><strong>{ownedSkills.reduce((n,[,v])=>n+Number(v),0)}</strong></div><div><span>KILLS</span><strong>{fmt(state.totalKills)}</strong></div></div>
      <div className="io-combat-columns"><section className="io-combat-panel"><div className="io-combat-panel-head"><div><span className="io-combat-eyebrow">FIELD NOTES</span><h2>Combat log</h2></div><span>{processing?'RESOLVING':paused?'PAUSED':auto?'AUTO-RUN':'MANUAL'}</span></div><div className="io-combat-log" aria-live="polite">{actions.length?actions.map((a,i)=><p key={state.sequence+'-'+i} className={'io-log-'+a.actor+' io-log-'+a.kind}>{a.text}</p>):<p>The Delver readies a weapon. The first beat is imminent.</p>}</div></section>
        <section className="io-combat-panel"><div className="io-combat-panel-head"><div><span className="io-combat-eyebrow">YOUR LOADOUT</span><h2>Equipped</h2></div><button className="io-combat-text-link" type="button" onClick={()=>onNavigate('gear')}>Armory →</button></div><div className="io-combat-equipped-line"><span>WEAPON</span><strong>{weapon?.name||'Empty slot'}</strong><small>{weapon?.effect||'No effect'}</small></div><div className="io-combat-equipped-line"><span>ARMOR</span><strong>{armor?.name||'Empty slot'}</strong><small>{armor?.effect||'No effect'}</small></div><button className="io-combat-button is-primary" type="button" onClick={()=>onNavigate('skills')}>Open Skill Gacha</button></section></div>
    </>}

    {page==='dungeons'&&<>
      <div className="io-combat-dungeon-hero"><div className="io-combat-dungeon-art"><div className="io-combat-door">⌁</div><span>THE UNDERCRYPT</span><small>ONE WAY DOWN. DEATH SENDS YOU BACK TO THE DOOR.</small></div><div className="io-combat-dungeon-summary"><span className="io-combat-eyebrow">ACTIVE EXPEDITION</span><h2>The Undercrypt</h2><p>Enemy types and rooms rotate with depth. Every tenth depth ends in a Crypt Warden boss fight. Auto-combat resumes from the current room while this mode is open.</p><div className="io-combat-dungeon-metrics"><div><span>CURRENT DEPTH</span><strong>{fmt(state.depth)}</strong></div><div><span>PERSONAL BEST</span><strong>{fmt(state.bestDepth)}</strong></div><div><span>{state.depth%10===0?'CURRENT WARDEN':'NEXT WARDEN'}</span><strong>{fmt(nextBoss)}</strong></div><div><span>ORB LUCK BONUS</span><strong>+{orbLuckBonusPct}%</strong></div></div><p className="io-combat-resonance-note">{fmt(wardensDefeated)} Crypt Wardens defeated · +1% permanent effective Luck per Warden, capped at +25%. Applies to Infinity Orbs rolls.</p><button type="button" className="io-combat-button is-primary" onClick={()=>onNavigate('fight')}>Return to Fight →</button></div></div>
      <div className="io-combat-panel io-combat-rule-panel"><span className="io-combat-eyebrow">RUN RULES</span><h2>Death is a setback, not a wipe.</h2><p>Health persists between rooms. On death, a new push begins at Depth 1 with full health. Best depth, Delver Coins, levels, skill ranks, and collected gear stay with you.</p><p>Gear quality rolls from 0.00% to 100.00%. Weapon and armor traits activate while equipped; nearly perfect quality rolls are rare.</p></div>
    </>}

    {page==='gear'&&<>
      <div className="io-combat-stat-strip"><div><span>WEAPON DAMAGE</span><strong>+{fmt(weapon?.damageBonus||0)}</strong></div><div><span>WEAPON SPEED</span><strong>+{fmt(weapon?.speedBonus||0)}</strong></div><div><span>ARMOR HEALTH</span><strong>+{fmt(armor?.maxHealthBonus||0)}</strong></div><div><span>DAMAGE MITIGATION</span><strong>{percent(stats.damageReduction)}</strong></div></div>
      <div className="io-combat-panel"><div className="io-combat-panel-head"><div><span className="io-combat-eyebrow">ACTIVE BUILD</span><h2>Every stat matters</h2></div></div><div className="io-combat-equipped-grid">{([{slot:'weapon' as const,item:weapon,label:'WEAPON'},{slot:'armor' as const,item:armor,label:'ARMOR'}]).map(s=><div className="io-combat-equipped-card" key={s.slot}><span>{s.label}</span><strong>{s.item?.name||'Empty'}</strong><p>{s.item?.effect||'No special effect.'}</p><small>{s.slot==='weapon'?'+'+fmt(s.item?.damageBonus||0)+' DMG · +'+fmt(s.item?.speedBonus||0)+' SPD':'+'+fmt(s.item?.maxHealthBonus||0)+' MAX HP'}</small></div>)}</div></div>
      <div className="io-combat-inventory-head"><div><span className="io-combat-eyebrow">BAG</span><h2>Collected gear</h2></div><span>{state.inventory.length} / 30 · newest first</span></div>
      <div className="io-combat-gear-grid">{state.inventory.map(item=><GearCard key={item.id} item={item} isEquipped={state.equipment[item.slot]===item.id} busy={mutating} onEquip={()=>void mutate('/api/combat/equip',{itemId:item.id})}/>)}</div>
    </>}

    {page==='skills'&&<>
      <div className="io-combat-skill-banner"><div><span className="io-combat-eyebrow">SKILL GACHA</span><h2>Duplicates raise rank. All ranks stack.</h2><p>Five skills in each of five rarities. Pulls cost Delver Coins; each copy adds one rank up to Rank 5.</p></div><div className="io-combat-pull-box"><span><Coins size={15}/> {fmt(state.coins)} DELVER COINS</span><button type="button" className="io-combat-button is-primary" disabled={mutating||state.coins<pullCost} onClick={()=>void mutate('/api/combat/skills/roll')}>{mutating?'Rolling…':'Roll Skill · '+fmt(pullCost)}</button><small>Rates: Common 55% · Uncommon 25% · Rare 12% · Epic 6% · Mythic 2%</small></div></div>
      {lastSkill&&<div className={'io-combat-skill-result '+rarityClass(lastSkill.rarity)}><Sparkles size={18}/><div><strong>{lastSkill.name}</strong><p>{lastSkill.duplicate?'Duplicate pulled. ':'New skill discovered. '}{lastSkill.rank>0?'Now Rank '+lastSkill.rank+'. ':''}{lastSkill.convertedCoins>0?'Rank cap reached; converted to +'+fmt(lastSkill.convertedCoins)+' coins.':''}</p></div><span>{lastSkill.rarity.toUpperCase()}</span></div>}
      <div className="io-combat-codex-toolbar"><div><span className="io-combat-eyebrow">SKILL CODEX</span><h2>{ownedSkills.length} / {COMBAT_SKILLS.length} discovered</h2></div><button type="button" className="io-combat-button is-secondary" onClick={()=>setShowAllSkills(!showAllSkills)}>{showAllSkills?'Owned only':'Show all 25'}</button></div>
      <div className="io-combat-skill-grid">{visibleSkills.map(skill=>{const rank=rankOf(state,skill.id);return <article key={skill.id} className={'io-combat-skill-card '+rarityClass(skill.rarity)}><div className="io-combat-skill-card-head"><span>{skill.rarity.toUpperCase()}</span><b>{rank?'RANK '+rank+'/'+SKILL_RANK_CAP:'NOT OWNED'}</b></div><h3>{skill.name}</h3><p>{skill.effect}</p>{rank>0&&<div className="io-combat-skill-progress"><span style={{width:(rank/SKILL_RANK_CAP*100)+'%'}}/></div>}{rank>0&&<small>Current effect: {skillValue(skill,rank)}</small>}</article>;})}</div>
    </>}

    {page==='arena'&&<div className="io-combat-arena"><div className="io-combat-arena-glyph"><Swords size={34}/></div><span className="io-combat-eyebrow">PVP · NEXT COMBAT SLICE</span><h2>The Arena is not open yet.</h2><p>Gear, speed-action timing, and duplicate-leveling skills are being established first. Matchmaking and player-versus-player results will be server-authoritative when implemented. This screen does not simulate fake opponents or award fake wins.</p><button type="button" className="io-combat-button is-primary" onClick={()=>onNavigate('fight')}>Back to the Undercrypt</button></div>}
  </section>;
};
