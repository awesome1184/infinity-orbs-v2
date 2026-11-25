import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Coins, Gem, RefreshCw, Sparkles, Star, ShieldCheck } from 'lucide-react';
import { sound } from '../sound.js';
import type { CombatRune, CombatRuneRarity, CombatRuneStat, CombatSnapshot } from '../../shared/combat.js';
import {
  COMBAT_RUNE_RARITIES,
  combatRuneBonuses,
  combatRuneEffectText,
  shouldAutoSacrificeRune,
  combatRuneRarityAtOrBelow,
  combatRuneExperienceForLevel,
  combatRuneMajorAbilitySummary,
  combatRuneSlotsUnlocked,
} from '../../shared/combat.js';

async function request<T>(url:string,method='GET',body?:unknown):Promise<T>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15_000);
  try{
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Rune request failed.');
    return data as T;
  }catch(error){
    if(error instanceof Error&&error.name==='AbortError')throw new Error('Rune request timed out. Refresh your inventory before trying again.');
    throw error;
  }finally{clearTimeout(timeout);}
}
const RARITY_ORDER:Record<string,number>={Transcendent:10,Celestial:9,Astral:8,Cosmic:7,Mythic:6,Legendary:5,Epic:4,Rare:3,Uncommon:2,Common:1};
const STAT_LABEL:Record<CombatRuneStat,string>={luckPct:'Orb Luck',coinGainPct:'Coin gain',shardChancePct:'Shard chance',xpGainPct:'XP gain'};
const STAT_ICON:Record<CombatRuneStat,React.ReactNode>={luckPct:<Sparkles size={25}/>,coinGainPct:<Coins size={25}/>,shardChancePct:<Gem size={25}/>,xpGainPct:<BookOpen size={25}/>};
const pct=(value:number,decimals=2)=>{
  const safe=Number.isFinite(value)?Math.max(0,value):0;
  return safe>=1e21?safe.toExponential(2)+'%':safe.toFixed(decimals)+'%';
};
const fmt=(value:unknown)=>{
  const number=Number(value);
  return Number.isFinite(number)&&number>0?Math.floor(number).toLocaleString():'0';
};
const rarityClass=(rarity:string)=>'io-rarity-'+rarity.toLowerCase();

interface SacrificeResponse extends CombatSnapshot {
  runeSacrifice?:{donorName:string;targetName:string;gainedXp:number;totalXp:number;level:number};
}
interface AutoSacrificeResponse extends CombatSnapshot {
  runeAutoSacrificeResult?:{runesSacrificed:number;totalXp:number};
}
const RUNE_RARITIES:CombatRuneRarity[]=COMBAT_RUNE_RARITIES;

export const RunesSection:React.FC=()=>{
  const [snapshot,setSnapshot]=useState<CombatSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [busyRune,setBusyRune]=useState<string|null>(null);
  const [sacrificing,setSacrificing]=useState(false);
  const [strengthenTargetId,setStrengthenTargetId]=useState('');
  const [sacrificeDonorId,setSacrificeDonorId]=useState('');
  const [inspectedRuneId,setInspectedRuneId]=useState('');
  const [runeFilter,setRuneFilter]=useState<'all'|'equipped'|'unequipped'|'auto'>('all');
  const [runeSearch,setRuneSearch]=useState('');
  const [autoSacrificeBusy,setAutoSacrificeBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const actionInFlightRef=useRef(false);
  // Compatibility alias for diagnostics and older audit checks; both names share one lock.
  const operationLockRef = actionInFlightRef;
  const snapshotRequestSequenceRef=useRef(0);
  const [operationPending,setOperationPending]=useState(false);
  const beginAction=useCallback(()=>{
    if(actionInFlightRef.current)return false;
    actionInFlightRef.current=true;setOperationPending(true);return true;
  },[]);
  const endAction=useCallback(()=>{actionInFlightRef.current=false;setOperationPending(false);},[]);
  const load=useCallback(async()=>{
    if(!beginAction())return;
    snapshotRequestSequenceRef.current+=1;
    const requestSequence=snapshotRequestSequenceRef.current;
    try{
      const result=await request<CombatSnapshot>('/api/combat/state');
      if(requestSequence!==snapshotRequestSequenceRef.current)return;
      setSnapshot(result);setError('');
    }catch(e){if(requestSequence===snapshotRequestSequenceRef.current)setError(e instanceof Error?e.message:'Could not load Runes.');}
    finally{setLoading(false);endAction();}
  },[beginAction,endAction]);
  useEffect(()=>{void load();},[load]);
  const state=snapshot?.state??null;
  const bestDepthCandidates=state?[state.bestDepth,...Object.values(state.dungeonBestDepths??{}).map(Number)].filter(depth=>Number.isFinite(depth)&&depth>=0):[];
  const bestRuneDepth=bestDepthCandidates.length?Math.max(...bestDepthCandidates):1;
  const slots=state?combatRuneSlotsUnlocked(state.level,bestRuneDepth):2;
  const bonuses=useMemo(()=>combatRuneBonuses(state?.runes??[],state?.equippedRunes??[]),[state?.runes,state?.equippedRunes]);
  const runes=useMemo(()=>[...(state?.runes??[])].sort((a,b)=>(RARITY_ORDER[b.rarity]??0)-(RARITY_ORDER[a.rarity]??0)||(Number(b.level)||1)-(Number(a.level)||1)||(Number.isFinite(b.value)?b.value:0)-(Number.isFinite(a.value)?a.value:0)||String(a.name??'').localeCompare(String(b.name??''))),[state?.runes]);
  const visibleRunes=useMemo(()=>{
    const query=runeSearch.trim().toLowerCase();
    return runes.filter(rune=>{
      const equipped=Boolean(state?.equippedRunes.includes(rune.id));
      const matchesFilter=runeFilter==='all'||(runeFilter==='equipped'&&equipped)||(runeFilter==='unequipped'&&!equipped)||(runeFilter==='auto'&&!equipped&&combatRuneRarityAtOrBelow(rune.rarity,state?.runeAutoSacrifice?.maxRarity??'Common'));
      const searchable=[rune.name,rune.stat,STAT_LABEL[rune.stat],rune.rarity,rune.majorAbility?.name??'',rune.majorAbility?.description??''].join(' ').toLowerCase();
      return matchesFilter&&(!query||searchable.includes(query));
    });
  },[runes,runeFilter,runeSearch,state?.equippedRunes,state?.runeAutoSacrifice?.maxRarity]);

  useEffect(()=>{
    if(strengthenTargetId&&!runes.some(rune=>rune.id===strengthenTargetId))setStrengthenTargetId('');
    if(inspectedRuneId&&!runes.some(rune=>rune.id===inspectedRuneId))setInspectedRuneId('');
  },[runes,strengthenTargetId,inspectedRuneId]);
  useEffect(()=>{const closeDetails=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;setInspectedRuneId('');setStrengthenTargetId('');const target=event.target;if(target instanceof HTMLElement&&target.closest('.io-runes-icon-wrap.is-inspected'))target.blur();};window.addEventListener('keydown',closeDetails);return()=>window.removeEventListener('keydown',closeDetails);},[]);
  const mutate=async(url:string,body:unknown,runeId:string,success:string)=>{
    if(!beginAction())return;
    setBusyRune(runeId);setError('');setNotice('');
    try{
      const result=await request<CombatSnapshot>(url,'POST',body);
      snapshotRequestSequenceRef.current+=1;setSnapshot(result);setNotice(success);
      if(url==='/api/combat/runes/equip')sound.playEquip();
      else if(url==='/api/combat/runes/sacrifice')sound.playSacrificeSound();
    }
    catch(e){sound.playError();setError(e instanceof Error?e.message:'Rune update failed.');}
    finally{setBusyRune(null);endAction();}
  };
  const equippedRunes=state?(state.equippedRunes.map(id=>state.runes.find(rune=>rune.id===id)).filter((rune):rune is CombatRune=>Boolean(rune))):[];

  const strengthenTargetRune=runes.find(rune=>rune.id===strengthenTargetId);
  const rawAutoSacrificeSettings=state?.runeAutoSacrifice??{enabled:false,maxRarity:'Rare' as CombatRuneRarity,targetRuneId:null,preserveSpecialEffects:true};
  const autoSacrificeSettings={
    enabled:rawAutoSacrificeSettings.enabled===true,
    maxRarity:RUNE_RARITIES.includes(rawAutoSacrificeSettings.maxRarity)?rawAutoSacrificeSettings.maxRarity:'Rare' as CombatRuneRarity,
    targetRuneId:typeof rawAutoSacrificeSettings.targetRuneId==='string'?rawAutoSacrificeSettings.targetRuneId:null,
    preserveSpecialEffects:rawAutoSacrificeSettings.preserveSpecialEffects!==false,
  };
  const autoSacrificeTarget=equippedRunes.find(rune=>rune.id===autoSacrificeSettings.targetRuneId)??equippedRunes.find(rune=>/insight/i.test(rune.name))??equippedRunes[0]??null;
  const autoSacrificeEligibleCount=state?runes.filter(rune=>
    !state.equippedRunes.includes(rune.id)&&shouldAutoSacrificeRune(rune,autoSacrificeSettings.maxRarity,autoSacrificeSettings.preserveSpecialEffects)
  ).length:0;
  const statCards=[
    {label:'Orb Luck',value:pct(bonuses.luckPct),icon:<Sparkles size={16}/>},
    {label:'Coin gain',value:pct(bonuses.coinGainPct),icon:<Coins size={16}/>},
    {label:'Shard chance',value:pct(bonuses.shardChancePct * 0.025,5),icon:<Gem size={16}/>},
    {label:'XP gain',value:pct(bonuses.xpGainPct),icon:<BookOpen size={16}/>},
  ];
  const sacrifice=async(targetId:string,donorId:string)=>{
    const target=state?.runes.find(rune=>rune.id===targetId);
    const donor=state?.runes.find(rune=>rune.id===donorId);
    if(!target||!donor||target.id===donor.id)return;
    if(!beginAction())return;
    setSacrificing(true);setError('');setNotice('');
    try{
      const result=await request<SacrificeResponse>('/api/combat/runes/sacrifice','POST',{targetRuneId:target.id,donorRuneId:donor.id});
      snapshotRequestSequenceRef.current+=1;setSnapshot(result);setStrengthenTargetId('');setSacrificeDonorId('');setInspectedRuneId('');
      const detail=result.runeSacrifice;
      setNotice(detail
        ?detail.donorName+' sacrificed into '+detail.targetName+': +'+fmt(detail.gainedXp)+' Rune XP. '+detail.targetName+' is now Level '+fmt(detail.level)+'.'
        :'Rune sacrificed to strengthen the selected Rune.');
    }catch(e){setError(e instanceof Error?e.message:'Rune sacrifice failed.');}
    finally{setSacrificing(false);endAction();}
  };
  const handleRuneClick=(rune:CombatRune)=>{
    if(actionInFlightRef.current)return;
    if(strengthenTargetId){
      if(rune.id===strengthenTargetId){
        setStrengthenTargetId('');setSacrificeDonorId('');setNotice('Strengthen selection cancelled.');
        return;
      }
      // Selecting a target must never consume another Rune implicitly. Make the
      // donor choice explicit, then require the dedicated confirmation button.
      setSacrificeDonorId(rune.id);
      setInspectedRuneId(rune.id);
      setError('');setNotice('Selected '+rune.name+' as donor. Confirm Sacrifice selected Rune to consume it.');
      return;
    }
    setError('');setInspectedRuneId(current=>current===rune.id?'':rune.id);
  };
  const saveAutoSacrificeSettings=async(
    enabled:boolean,
    maxRarity:CombatRuneRarity,
    targetRuneId:string|null=autoSacrificeSettings.targetRuneId,
    preserveSpecialEffects:boolean=autoSacrificeSettings.preserveSpecialEffects,
  )=>{
    if(!beginAction())return;
    setAutoSacrificeBusy(true);setError('');setNotice('');
    try{
      const result=await request<CombatSnapshot>('/api/combat/runes/auto-sacrifice/settings','POST',{enabled,maxRarity,targetRuneId,preserveSpecialEffects});
      snapshotRequestSequenceRef.current+=1;setSnapshot(result);
      const targetName=equippedRunes.find(rune=>rune.id===targetRuneId)?.name??(equippedRunes.find(rune=>/insight/i.test(rune.name))??equippedRunes[0])?.name??'your first equipped Rune';
      setNotice(enabled?'Auto Sacrifice enabled: Runes at or below '+maxRarity+' feed '+targetName+'. '+(preserveSpecialEffects?'Runes with Major Abilities are protected.':'Special-effect Runes may also be sacrificed.'):'Auto Sacrifice disabled.');
    }catch(e){setError(e instanceof Error?e.message:'Auto Sacrifice settings could not be saved.');}
    finally{setAutoSacrificeBusy(false);endAction();}
  };
  const processAutoSacrifice=async()=>{
    if(!beginAction())return;
    setAutoSacrificeBusy(true);setError('');setNotice('');
    try{
      const result=await request<AutoSacrificeResponse>('/api/combat/runes/auto-sacrifice/run','POST',{});
      snapshotRequestSequenceRef.current+=1;setSnapshot(result);
      const summary=result.runeAutoSacrificeResult;
      setNotice(summary
        ?'Auto Sacrifice consumed '+fmt(summary.runesSacrificed)+' Runes and granted '+fmt(summary.totalXp)+' Rune XP to '+(autoSacrificeTarget?.name??'the preferred equipped Rune')+'.'
        :'Auto Sacrifice completed.');
      setStrengthenTargetId('');
    }catch(e){setError(e instanceof Error?e.message:'Auto Sacrifice could not run.');}
    finally{setAutoSacrificeBusy(false);endAction();}
  };
  return <div className="io-runes-page">
    <header className="io-runes-header">
      <div><div className="io-runes-kicker">CORE-GAME BONUSES · SOFT-CAPPED LEVELS</div><h1>Runes</h1><p className="io-runes-intro">Equip monster drops to strengthen normal Infinity Orb rolls. Sacrifice spare Runes into a favorite Rune to grant XP and increase its level. Effects approach a large soft cap; Shard Rune chance never scales with level.</p></div>
      <button type="button" className="io-runes-button" aria-label={loading?'Refreshing Rune inventory':'Refresh Rune inventory'} aria-busy={loading||operationPending} onClick={()=>{setLoading(true);void load();}} disabled={loading||operationPending}><RefreshCw size={14} aria-hidden="true" className={loading?'animate-spin':''}/> {loading?'Loading…':'Refresh'}</button>
    </header>
    {error&&<div className="io-runes-error io-runes-error-row" role="alert"><span>{error}</span><button type="button" onClick={()=>{setLoading(true);void load();}} disabled={loading||Boolean(busyRune)||sacrificing||autoSacrificeBusy}>Retry</button></div>}
    {notice&&!error&&<div className="io-runes-muted" role="status" aria-live="polite">{notice}</div>}
    {operationPending&&<div className="io-runes-muted" role="status" aria-live="polite">Saving Rune changes…</div>}
    {loading&&!state?<div className="io-runes-loading">Loading Rune inventory…</div>:state&&<>
      <section className="io-runes-panel" aria-label="Equipped Rune loadout">
        <div className="io-runes-panel-head"><h2>Equipped loadout</h2><span className="io-runes-muted" aria-live="polite">{equippedRunes.length} / {slots} slots used · Delver Lv. {fmt(state.level)} · Best depth {fmt(bestRuneDepth)}</span></div>
        <div className="io-runes-loadout">{Array.from({length:slots},(_,index)=>{
          const rune=equippedRunes[index];
          return <div key={index} className={'io-runes-slot'+(rune?' is-filled':'')}>
            {rune?STAT_ICON[rune.stat]:<Star size={15} color="#475569"/>}
            {rune?<><strong className={'io-rarity-'+rune.rarity.toLowerCase()}>{rune.name}</strong><span>Lv. {fmt(rune.level??1)} · {combatRuneEffectText(rune)}</span>{rune.majorAbility&&<span className="io-runes-major">✦ {rune.majorAbility.name}</span>}</>:<span>Empty slot {index+1}</span>}
          </div>;
        })}</div>
        <div className="io-runes-stat-grid">{statCards.map(card=><div className="io-runes-stat" key={card.label}><span>{card.icon} {card.label}</span><strong>{card.value}</strong></div>)}</div>
        <p className="io-runes-muted" style={{marginTop:'.75rem'}}>Start with 2 Rune slots. Unlock slot 3 at Delver Level 10, slot 4 at Level 25, and slot 5 at Best Depth 50. Equipped Rune bonuses affect normal Orb-roll rewards, including offline rewards, not dungeon combat.</p>
      </section>
      <section className="io-runes-panel">
        <div className="io-runes-panel-head"><h2>Rune inventory</h2><span className="io-runes-muted">{state.runes.length} / 200 · {Math.max(0,200-state.runes.length)} slots free · {visibleRunes.length} shown</span>{state.runes.length>=200&&<span className="io-runes-capacity-warning" role="status">Inventory full — new Rune drops need an open slot.</span>}</div>
        {strengthenTargetRune&&<div className="io-runes-strengthen-mode" role="status">
          <div><strong>Strengthen: {strengthenTargetRune.name}</strong><span>Select a donor and confirm. It is permanently consumed for XP; an equipped donor also removes its loadout bonus.</span></div>
          <label className="io-runes-auto-rarity">Donor Rune
            <select className="io-runes-button" value={sacrificeDonorId} disabled={operationPending||sacrificing||autoSacrificeBusy} onChange={event=>setSacrificeDonorId(event.target.value)} aria-label="Rune to sacrifice">
              <option value="">Choose a Rune to consume…</option>
              {runes.filter(rune=>rune.id!==strengthenTargetRune.id).map(rune=><option key={rune.id} value={rune.id}>{rune.name} · {rune.rarity} · Lv. {fmt(rune.level??1)}</option>)}
            </select>
          </label>
          <button type="button" className="io-runes-button io-runes-strengthen-button" disabled={operationPending||sacrificing||autoSacrificeBusy||!sacrificeDonorId||!runes.some(rune=>rune.id===sacrificeDonorId&&rune.id!==strengthenTargetRune.id)} onClick={()=>{const donor=runes.find(rune=>rune.id===sacrificeDonorId&&rune.id!==strengthenTargetRune.id);if(!donor)return;if(state?.equippedRunes.includes(donor.id)&&typeof window!=='undefined'&&!window.confirm('This Rune is equipped and contributes to your loadout. Sacrificing it permanently consumes it and removes its bonus. Continue?'))return;setSacrificeDonorId('');void sacrifice(strengthenTargetRune.id,donor.id);}}>Sacrifice selected Rune</button>
          <button type="button" className="io-runes-button" disabled={operationPending||sacrificing} onClick={()=>{setStrengthenTargetId('');setSacrificeDonorId('');setNotice('Strengthen selection cancelled.');}}>Cancel</button>
        </div>}
        <div className="io-runes-auto-sacrifice">
          <div className="io-runes-auto-sacrifice-heading"><strong>Auto Sacrifice</strong><span>Turn low-rarity drops into XP for your equipped loadout.</span></div>
          <label className="io-runes-auto-toggle">
            <input type="checkbox" checked={autoSacrificeSettings.enabled} disabled={operationPending||autoSacrificeBusy} onChange={event=>void saveAutoSacrificeSettings(event.target.checked,autoSacrificeSettings.maxRarity)}/>
            <span>Automatically strengthen a chosen equipped Rune with new drops</span>
          </label>
          <label className="io-runes-auto-rarity">Sacrifice rarity
            <select aria-label="Maximum Rune rarity to sacrifice automatically" value={autoSacrificeSettings.maxRarity} disabled={operationPending||autoSacrificeBusy} onChange={event=>void saveAutoSacrificeSettings(autoSacrificeSettings.enabled,event.target.value as CombatRuneRarity)}>
              {RUNE_RARITIES.map(rarity=><option key={rarity} value={rarity}>{rarity} and below</option>)}
            </select>
          </label>
          <label className="io-runes-auto-rarity">Strengthen target
            <select
              aria-label="Equipped Rune to strengthen automatically"
              value={autoSacrificeSettings.targetRuneId&&equippedRunes.some(rune=>rune.id===autoSacrificeSettings.targetRuneId)?autoSacrificeSettings.targetRuneId:''}
              disabled={operationPending||autoSacrificeBusy||equippedRunes.length===0}
              onChange={event=>void saveAutoSacrificeSettings(autoSacrificeSettings.enabled,autoSacrificeSettings.maxRarity,event.target.value||null)}
            >
              <option value="">Prefer Insight Rune, otherwise first equipped</option>
              {equippedRunes.map(rune=><option key={rune.id} value={rune.id}>{rune.name}</option>)}
            </select>
          </label>
          <label className="io-runes-auto-toggle">
            <input type="checkbox" checked={autoSacrificeSettings.preserveSpecialEffects} disabled={operationPending||autoSacrificeBusy} onChange={event=>void saveAutoSacrificeSettings(autoSacrificeSettings.enabled,autoSacrificeSettings.maxRarity,autoSacrificeSettings.targetRuneId,event.target.checked)}/>
            <span>Preserve Runes with Major Abilities</span>
          </label>
          <button type="button" className="io-runes-button io-runes-process-button" disabled={operationPending||autoSacrificeBusy||equippedRunes.length===0||autoSacrificeEligibleCount===0} onClick={()=>void processAutoSacrifice()}>
            {autoSacrificeBusy?'Processing…':'Sacrifice '+fmt(autoSacrificeEligibleCount)+' eligible Runes now'}
          </button>
          {autoSacrificeSettings.enabled&&equippedRunes.length===0&&<p className="io-runes-auto-warning" role="status">Auto Sacrifice is enabled, but no Runes are equipped. New eligible drops are kept until you equip a target.</p>}
          <p>When enabled, eligible un-equipped Runes at or below the selected rarity feed the selected target. With no explicit target, an equipped Insight Rune is preferred, then the first equipped Rune. When preservation is on, Runes with Major Abilities are never auto-sacrificed. The button processes existing eligible Runes too; manual Strengthen can still consume other Runes and warns before consuming an equipped Rune.</p>
          {equippedRunes.length===0&&<p className="io-runes-muted" role="note">Equip at least one Rune before Auto Sacrifice can consume drops. Existing eligible Runes will be kept until a target is equipped.</p>}
        </div>
        <div className="io-runes-inventory-tools">
          <label className="io-runes-search">Search Rune inventory by name, rarity, stat, or Major Ability
            <input type="search" value={runeSearch} onChange={event=>setRuneSearch(event.target.value.slice(0,80))} placeholder="Name, rarity, stat, or Major Ability…" maxLength={80} aria-label="Search Rune inventory by name, rarity, stat, or Major Ability"/>
          </label>
          <div role="group" aria-label="Filter Rune inventory" className="io-runes-filter-group">
            {([{id:'all',label:'All'},{id:'equipped',label:'Equipped'},{id:'unequipped',label:'Unequipped'},{id:'auto',label:'Auto-sacrifice eligible'}] as const).map(option=><button key={option.id} type="button" aria-pressed={runeFilter===option.id} disabled={operationPending} onClick={()=>setRuneFilter(option.id)}>{option.label}</button>)}
          </div>
          <p className="io-runes-muted" role="status" aria-live="polite">Showing {fmt(visibleRunes.length)} of {fmt(runes.length)} Runes · {fmt(equippedRunes.length)} equipped · Inventory limit 200</p>
        </div>
        {!runes.length?<div className="io-runes-empty"><Gem size={22} style={{margin:'0 auto .5rem',color:'#a78bfa'}}/><strong style={{display:'block',color:'#e2e8f0'}}>No Runes found yet</strong>Defeat monsters in Combat. Common monsters can drop a Rune, elite enemies have a higher chance, and bosses always drop one.</div>:
          <>
          {visibleRunes.length===0?<div className="io-runes-empty">No matching Runes. Choose All, clear the search, or change the rarity/stat filter.</div>:
          <div className="io-runes-inventory">{visibleRunes.map(rune=>{
            const isEquipped=state.equippedRunes.includes(rune.id);
            const canEquip=isEquipped||state.equippedRunes.length<slots;
            const level=Math.max(1,Math.floor(Number(rune.level)||1));
            const levelXp=Math.max(0,Math.floor(Number(rune.experience)||0));
            const nextXp=combatRuneExperienceForLevel(level+1);
            const currentXp=combatRuneExperienceForLevel(level);
            const progressRange=nextXp-currentXp;
            const xpProgress=progressRange>0?Math.max(0,Math.min(100,(levelXp-currentXp)/progressRange*100)):100;
            const iconLabel=(isEquipped?'Unequip ':'Equip ')+rune.name;
            return <article key={rune.id} className={'io-runes-icon-wrap '+rarityClass(rune.rarity)+(isEquipped?' is-equipped':'')+(inspectedRuneId===rune.id?' is-inspected':'')}>
              <button type="button" className={'io-runes-icon '+rarityClass(rune.rarity)+(isEquipped?' is-equipped':'')+(strengthenTargetId===rune.id?' is-strengthen-target':'')} disabled={operationPending||sacrificing||(strengthenTargetId?false:busyRune===rune.id||(!isEquipped&&!canEquip))} onClick={()=>handleRuneClick(rune)} aria-describedby={'io-rune-tooltip-'+encodeURIComponent(rune.id)} aria-pressed={strengthenTargetId?strengthenTargetId===rune.id:isEquipped} aria-label={strengthenTargetId?(rune.id===strengthenTargetId?'Cancel Strengthen selection':'Select '+rune.name+' as sacrifice donor'):iconLabel} title={strengthenTargetId?(rune.id===strengthenTargetId?'Cancel Strengthen selection':'Select as donor for '+(strengthenTargetRune?.name??'selected Rune')):iconLabel}>
                <span className="io-runes-icon-art">{STAT_ICON[rune.stat]}</span><small>Lv. {fmt(level)}</small>{isEquipped&&<span className="io-runes-equipped-mark"><ShieldCheck size={12}/></span>}
              </button>
              <div id={'io-rune-tooltip-'+encodeURIComponent(rune.id)} className="io-runes-tooltip" role="tooltip">
                <span className={'io-runes-tooltip-rarity '+rarityClass(rune.rarity)}>{rune.rarity.toUpperCase()} · {STAT_LABEL[rune.stat].toUpperCase()}</span>
                <strong>{rune.name}</strong><span className="io-runes-tooltip-level">Level {fmt(level)} · Rune XP {fmt(levelXp)} / {fmt(nextXp)} · Found at depth {rune.sourceDepth+1}</span>
                <div className="io-runes-xp-track" role="progressbar" aria-label={rune.name+' progress toward level '+fmt(level+1)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(xpProgress)} aria-valuetext={Math.round(xpProgress)+' percent toward level '+fmt(level+1)}><span style={{width:xpProgress+'%'}}/></div>
                <p className="io-runes-tooltip-value">{combatRuneEffectText(rune)}</p>
                <p>{rune.stat==='luckPct'?'Improves rarity odds on normal orb rolls.':rune.stat==='coinGainPct'?'Increases Coins earned from normal orb rolls.':rune.stat==='shardChancePct'?'Adds the effective Shard chance shown above; Rune levels do not alter this stat.':'Increases XP earned from normal orb rolls.'}</p>
                {rune.majorAbility&&<div className="io-runes-major-card"><span>✦ MAIN-GAME MAJOR ABILITY</span><strong>{rune.majorAbility.name} · RARITY + LEVEL-SCALING EFFECT</strong><p>{combatRuneMajorAbilitySummary(rune.majorAbility,level,rune.rarity)}</p></div>}
                <div className="io-runes-tooltip-actions">
                  {strengthenTargetId===rune.id
                    ?<button type="button" className="io-runes-button" disabled={operationPending||sacrificing} onClick={()=>{setStrengthenTargetId('');setNotice('Strengthen selection cancelled.');}}>Cancel Strengthen</button>
                    :<button type="button" className="io-runes-button io-runes-strengthen-button" disabled={operationPending||sacrificing||autoSacrificeBusy} onClick={()=>{setStrengthenTargetId(rune.id);setSacrificeDonorId('');setError('');setNotice('Strengthen '+rune.name+': choose a donor Rune from the selector above.');}}>Strengthen</button>}
                </div>
                {!isEquipped&&!canEquip&&<div className="io-runes-muted">All Rune slots are full.</div>}
              </div>
              <button type="button" className={isEquipped?'io-runes-button io-runes-equip-button is-equipped':'io-runes-button io-runes-equip-button'} disabled={operationPending||sacrificing||autoSacrificeBusy||busyRune===rune.id||Boolean(strengthenTargetId)||(!isEquipped&&!canEquip)} onClick={()=>void mutate('/api/combat/runes/equip',{runeId:rune.id,equip:!isEquipped},rune.id,isEquipped?'Rune unequipped.':'Rune equipped.')} aria-label={(isEquipped?'Unequip ':'Equip ')+rune.name}>{busyRune===rune.id?'Saving…':isEquipped?'Unequip':'Equip'}</button>
            </article>;
          })}</div>
          }
          </>
        }
      </section>
    </>}
  </div>;
};
