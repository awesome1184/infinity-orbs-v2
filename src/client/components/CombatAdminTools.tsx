import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Coins, Gem, Gauge, HeartPulse, RefreshCw, Shield, Sparkles, Sword, Zap } from 'lucide-react';
import { COMBAT_MAJOR_ABILITY_IDS, COMBAT_RUNE_RARITIES, type CombatGearSlot, type CombatRuneRarity, type CombatRuneStat, type CombatSnapshot } from '../../shared/combat.js';

type Projection={depth:number;damage:number;speed:number;maxHealth:number;maxOrbCritDamage:number;enemyHp:number;enemyDamage:number;enemySpeed:number};
type LabResponse=CombatSnapshot&{
  labMessage?:string; actions?:Array<{actor:string;kind:string;text:string}>;
  orbRoll?:{rarity:number;tier:string;name:string;damageMultiplier:number;baseDamage:number};
  balance?:{generatedAt:number;rarityOdds:Record<string,number>;statBudgets:Record<string,number>;projections:Projection[];checks:Array<{label:string;passed:boolean;detail:string}>};
};
const slots:CombatGearSlot[]=['weapon','helmet','armor','gloves','boots','ring','amulet'];
const runeRarities:CombatRuneRarity[]=COMBAT_RUNE_RARITIES;
const runeStats:CombatRuneStat[]=['luckPct','coinGainPct','shardChancePct','xpGainPct'];
const runeMajorAbilityIds=['fateweaver','midas-engine','memory-well'] as const;
const fmt=(v:unknown)=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
const title=(v:string)=>v.split('-').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');
async function request<T>(url:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Combat Lab request failed.');
  return data as T;
}
const field='mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100';
const button='inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50';
export const CombatAdminTools:React.FC=()=>{
  const [data,setData]=useState<LabResponse|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [lastActions,setLastActions]=useState<Array<{actor:string;kind:string;text:string}>>([]);
  const [depth,setDepth]=useState('1000'),[scrap,setScrap]=useState('100000'),[marks,setMarks]=useState('100000');
  const [slot,setSlot]=useState<CombatGearSlot>('weapon'),[quality,setQuality]=useState('90'),[gearAbility,setGearAbility]=useState('none');
  const [runeRarity,setRuneRarity]=useState<CombatRuneRarity>('Transcendent'),[runeStat,setRuneStat]=useState<CombatRuneStat>('luckPct'),[runeAbility,setRuneAbility]=useState('none');
  const refresh=useCallback(async(showNotice=false)=>{
    try{const result=await request<LabResponse>('/api/dev/combat-lab/state');setData(result);setError('');if(showNotice)setNotice('Combat snapshot and diagnostics refreshed.');}
    catch(e){setError(e instanceof Error?e.message:'Could not load Combat Lab.');}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const act=async(action:string,body:Record<string,unknown>={})=>{
    setBusy(true);setError('');setNotice('');
    try{
      const result=await request<LabResponse>('/api/dev/combat-lab/action','POST',{action,...body});
      setLastActions(Array.isArray(result.actions)?result.actions:[]);
      setNotice(result.labMessage||'Combat Lab action completed.');
      const current=await request<LabResponse>('/api/dev/combat-lab/state');setData(current);
    }catch(e){setError(e instanceof Error?e.message:'Combat Lab action failed.');}
    finally{setBusy(false);}
  };
  const state=data?.state,stats=data?.stats,checks=data?.balance?.checks??[];
  const passed=checks.filter(check=>check.passed).length;
  return <details className="rounded-2xl border border-violet-400/40 bg-violet-950/10 p-3">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-violet-200">
      <span className="flex items-center gap-2"><Activity className="h-4 w-4"/> Combat Lab · Combat Update</span>
      <span className="text-[10px] font-semibold text-violet-300/70">Progression · Gear · Runes · Beats</span>
    </summary>
    <div className="mt-3 space-y-4">
      <p className="text-[11px] leading-relaxed text-slate-400">Admin-only fixtures for testing the Combat update. Changes apply to your Combat save only and never alter your main Infinity Orbs save. Force Beat bypasses cooldown only through this protected test endpoint; ordinary play still follows the server's 30-second cadence.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={()=>void refresh(true)} className={button}><RefreshCw className="h-3.5 w-3.5"/> Refresh State & Tests</button>
        <button type="button" disabled={busy} onClick={()=>void act('late-game-preset')} className={button}><Zap className="h-3.5 w-3.5"/> Apply Late-Game Build</button>
        <button type="button" disabled={busy} onClick={()=>void act('force-beat')} className={button}><Sword className="h-3.5 w-3.5"/> Force One Beat</button>
        <button type="button" disabled={busy} onClick={()=>void act('heal')} className={button}><HeartPulse className="h-3.5 w-3.5"/> Heal + Reset Cooldown</button>
        <button type="button" disabled={busy} onClick={()=>{if(window.confirm('Reset only your Combat save? Your main Infinity Orbs save is unchanged.'))void act('reset-combat');}} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-100 disabled:opacity-50"><Shield className="h-3.5 w-3.5"/> Reset Combat Save</button>
      </div>
      {error&&<div role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">{error}</div>}
      {notice&&!error&&<div role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-2.5 text-xs text-emerald-200">{notice}</div>}
      {state&&stats&&<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Depth',fmt(state.depth),'text-violet-200'],['Damage stat',fmt(stats.damage),'text-rose-200'],['Speed stat',fmt(stats.speed),'text-cyan-200'],['Maximum HP',fmt(stats.maxHealth),'text-emerald-200'],
          ['Scrap',fmt(state.scrap),'text-amber-200'],['Combat Marks',fmt(state.combatMarks),'text-amber-200'],['Gear / Runes',state.inventory.length+' / '+state.runes.length,'text-slate-100'],['Ability Runes',state.runes.filter(rune=>rune.majorAbility).length+' / '+state.runes.length,'text-fuchsia-200'],
        ].map(([label,value,color])=><div key={label} className="rounded-xl border border-slate-800 bg-slate-900/75 p-2.5"><div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div><div className={'mt-1 break-words font-mono text-sm font-black '+color}>{value}</div></div>)}
      </div>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-200"><Gauge className="h-4 w-4"/> Progression & Economy</h3>
          <label className="block text-[10px] font-semibold text-slate-400">Depth (1–50,000)<input aria-label="Combat Lab test depth" className={field} type="number" min="1" max="50000" value={depth} onChange={e=>setDepth(e.target.value)}/></label>
          <button type="button" disabled={busy||!Number.isFinite(Number(depth))||Number(depth)<1||Number(depth)>50000} onClick={()=>void act('set-depth',{depth:Number(depth)})} className={button}>Set Depth & Refresh Enemy</button>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] font-semibold text-slate-400">Grant Scrap<input aria-label="Scrap grant" className={field} type="number" min="0" max="1000000000000" value={scrap} onChange={e=>setScrap(e.target.value)}/></label>
            <label className="block text-[10px] font-semibold text-slate-400">Grant Combat Marks<input aria-label="Combat Marks grant" className={field} type="number" min="0" max="1000000000000" value={marks} onChange={e=>setMarks(e.target.value)}/></label>
          </div>
          <button type="button" disabled={busy||![scrap,marks].every(v=>Number.isFinite(Number(v))&&Number(v)>=0)} onClick={()=>void act('grant-resources',{scrap:Number(scrap),marks:Number(marks)})} className={button}><Coins className="h-3.5 w-3.5"/> Grant Resources</button>
          <button type="button" disabled={busy} onClick={()=>void act('clear-cooldown')} className={button}>Clear Beat Cooldown</button>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-200"><Sword className="h-4 w-4"/> Generate Gear</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] font-semibold text-slate-400">Slot<select className={field} value={slot} onChange={e=>setSlot(e.target.value as CombatGearSlot)}>{slots.map(value=><option key={value} value={value}>{title(value)}</option>)}</select></label>
            <label className="block text-[10px] font-semibold text-slate-400">Quality %<input className={field} type="number" min="0" max="100" step="0.01" value={quality} onChange={e=>setQuality(e.target.value)}/></label>
          </div>
          <label className="block text-[10px] font-semibold text-slate-400">Major Ability<select className={field} value={gearAbility} onChange={e=>setGearAbility(e.target.value)}><option value="none">None</option>{COMBAT_MAJOR_ABILITY_IDS.map(id=><option key={id} value={id}>{title(id)}</option>)}</select></label>
          <button type="button" disabled={busy||!Number.isFinite(Number(quality))||Number(quality)<0||Number(quality)>100} onClick={()=>void act('grant-gear',{slot,quality:Number(quality),majorAbility:gearAbility})} className={button}><Sparkles className="h-3.5 w-3.5"/> Grant & Equip Test Gear</button>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-200"><Gem className="h-4 w-4"/> Generate Runes</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] font-semibold text-slate-400">Rune rarity<select className={field} value={runeRarity} onChange={e=>setRuneRarity(e.target.value as CombatRuneRarity)}>{runeRarities.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
            <label className="block text-[10px] font-semibold text-slate-400">Rune stat<select className={field} value={runeStat} onChange={e=>setRuneStat(e.target.value as CombatRuneStat)}>{runeStats.map(value=><option key={value} value={value}>{title(value)}</option>)}</select></label>
          </div>
          <label className="block text-[10px] font-semibold text-slate-400">Major Ability<select className={field} value={runeAbility} onChange={e=>setRuneAbility(e.target.value)}><option value="none">None</option>{runeMajorAbilityIds.map(id=><option key={id} value={id}>{title(id)}</option>)}</select></label>
          <button type="button" disabled={busy} onClick={()=>void act('grant-rune',{rarity:runeRarity,stat:runeStat,majorAbility:runeAbility})} className={button}><Gem className="h-3.5 w-3.5"/> Grant & Equip Test Rune</button>
        </section>
      </div>
      {data?.balance&&<section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/55 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-black uppercase tracking-wider text-violet-200">Balance Projection & Smoke Checks</h3><span className={'rounded-full border px-2 py-1 text-[10px] font-black '+(passed===checks.length?'border-emerald-400/30 text-emerald-200':'border-amber-400/30 text-amber-200')}>{passed}/{checks.length} checks passing</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Object.entries(data.balance.rarityOdds).map(([rarity,odds])=><div key={rarity} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><div className="text-[9px] uppercase text-slate-500">{rarity}</div><strong className="font-mono text-xs text-slate-100">{(Number(odds)*100).toFixed(2)}%</strong></div>)}</div>
        <div className="overflow-x-auto rounded-lg border border-slate-800"><table className="w-full min-w-[680px] text-left text-[10px]"><thead className="bg-slate-950 text-slate-400"><tr>{['Depth','Damage','Speed','Max HP','Orb crit estimate','Enemy HP','Enemy hit'].map(label=><th key={label} className="px-2 py-2 font-bold">{label}</th>)}</tr></thead><tbody>{data.balance.projections.map(p=><tr key={p.depth} className="border-t border-slate-800 text-slate-200"><td className="px-2 py-2 font-mono">{fmt(p.depth)}</td><td className="px-2 py-2 font-mono">{fmt(p.damage)}</td><td className="px-2 py-2 font-mono">{fmt(p.speed)}</td><td className="px-2 py-2 font-mono">{fmt(p.maxHealth)}</td><td className="px-2 py-2 font-mono text-amber-200">{fmt(p.maxOrbCritDamage)}</td><td className="px-2 py-2 font-mono">{fmt(p.enemyHp)}</td><td className="px-2 py-2 font-mono">{fmt(p.enemyDamage)}</td></tr>)}</tbody></table></div>
        <div className="space-y-1.5">{checks.map(check=><div key={check.label} className="flex gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2"><span className={'mt-px font-black '+(check.passed?'text-emerald-300':'text-rose-300')}>{check.passed?'PASS':'FAIL'}</span><div className="min-w-0"><div className="text-[10px] font-bold text-slate-200">{check.label}</div><p className="text-[10px] text-slate-500">{check.detail}</p></div></div>)}</div>
      </section>}
      {lastActions.length>0&&<section className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><h3 className="mb-2 text-xs font-black uppercase text-slate-300">Latest Forced Beat Log</h3><div className="space-y-1">{lastActions.slice(0,12).map((action,index)=><p key={index} className="text-[10px] text-slate-400">{action.text}</p>)}</div>{data?.orbRoll&&<p className="mt-2 text-xs text-amber-200">Orb: {data.orbRoll.name} · ×{data.orbRoll.damageMultiplier.toFixed(2)} · {fmt(data.orbRoll.baseDamage)} base damage</p>}</section>}
      {data&&<p className="text-[9px] text-slate-600">Report generated {new Date(data.balance?.generatedAt??0).toLocaleTimeString()} · Stat budget: {Object.entries(data.balance?.statBudgets??{}).map(([q,m])=>q+'% ×'+Number(m).toFixed(2)).join(' · ')}</p>}
    </div>
  </details>;
};
