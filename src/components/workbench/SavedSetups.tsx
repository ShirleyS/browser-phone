import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PhoneEngine, PhoneState } from '@/lib/phone/engine';
import { accountClient, type AccountClient } from '@/lib/account/client';
import type { AccountStatus, SavedSetupSummary } from '@/lib/account/types';
type Engine=Pick<PhoneEngine,'setContact'|'setLang'|'setAgentId'|'setConnection'|'setMode'|'clearChat'>;
type State=Pick<PhoneState,'contact'|'lang'|'agentId'|'connection'>;
const copy={
  en:{title:'Save my setup (optional)',help:'Use the phone without signing in. Sign in only to save and recover setups on other devices.',login:'Sign in to save',unavailable:'Saving is not available on this deployment yet. You can keep using the phone without signing in.',signed:'Signed in',name:'Setup name',save:'Save current setup',out:'Sign out',empty:'No saved setups yet.',load:'Load',remove:'Remove',working:'Working…',loading:'Loading saved setups…',pair:'Finish pairing before saving this connection.',loaded:'Setup loaded.',saved:'Setup saved.',removed:'Saved copy removed.',needsPairing:'Settings loaded. Pair the webhook again to reconnect.',failed:'Sign-in did not complete. Please try again.',loadHelp:'Loading replaces this tab’s settings and messages and ends any active call.',removeHelp:'Removing a saved copy keeps the webhook connection active. Use Forget connection to revoke it.',outHelp:'Signing out clears this tab’s connection and messages. Other devices stay connected.'},
  es:{title:'Guardar mi configuración (opcional)',help:'Usa el teléfono sin iniciar sesión. Inicia sesión solo para guardar y recuperar configuraciones en otros dispositivos.',login:'Iniciar sesión para guardar',unavailable:'Guardar aún no está disponible aquí. Puedes seguir usando el teléfono sin iniciar sesión.',signed:'Sesión iniciada',name:'Nombre de la configuración',save:'Guardar configuración actual',out:'Cerrar sesión',empty:'Aún no hay configuraciones guardadas.',load:'Cargar',remove:'Eliminar',working:'Procesando…',loading:'Cargando configuraciones…',pair:'Termina de verificar la conexión antes de guardarla.',loaded:'Configuración cargada.',saved:'Configuración guardada.',removed:'Copia guardada eliminada.',needsPairing:'Configuración cargada. Verifica el webhook de nuevo para conectar.',failed:'No se completó el inicio de sesión. Inténtalo otra vez.',loadHelp:'Cargar reemplaza la configuración y los mensajes de esta pestaña, y termina las llamadas activas.',removeHelp:'Eliminar una copia guardada mantiene activa la conexión. Usa Olvidar conexión para revocarla.',outHelp:'Cerrar sesión borra la conexión y los mensajes de esta pestaña. Los otros dispositivos siguen conectados.'},
};
export function SavedSetups({engine,state,client=accountClient}:{engine:Engine;state:State;client?:AccountClient}) {
  const tr=copy[state.lang];const [open,setOpen]=useState(false),[status,setStatus]=useState<AccountStatus|null>(null),[entries,setEntries]=useState<SavedSetupSummary[]>([]);
  const [label,setLabel]=useState(state.contact.name.slice(0,80)),[busy,setBusy]=useState(false),[err,setErr]=useState<string|null>(null),[note,setNote]=useState<string|null>(null);
  const epoch=useRef(0);
  const refresh=async()=>{
    const generation=++epoch.current;setBusy(true);setErr(null);
    try {
      const next=await client.status();if(generation!==epoch.current)return;setStatus(next);
      const rows=next.signed_in?await client.list():[];if(generation!==epoch.current)return;setEntries(rows);
    }catch(error){if(generation===epoch.current)setErr(error instanceof Error?error.message:'Could not load saved setups.');}
    finally{if(generation===epoch.current)setBusy(false);}
  };
  useEffect(()=>{
    const url=new URL(window.location.href),result=url.searchParams.get('setup_login');
    if(result==='success' || result==='failed') {
      url.searchParams.delete('setup_login');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
      setOpen(true);if(result==='failed')setNote(copy[state.lang].failed);void refresh();
    }
    return ()=>{epoch.current++;};
    // A callback is handled once; language changes must not replay authentication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const toggle=()=>{if(open){epoch.current++;setBusy(false);setOpen(false);}else{setOpen(true);void refresh();}};
  const act=async(action:(current:()=>boolean)=>Promise<void>)=>{
    const generation=++epoch.current;const current=()=>generation===epoch.current;setBusy(true);setErr(null);setNote(null);
    try{await action(current);}catch(error){if(current())setErr(error instanceof Error?error.message:'This action did not complete.');}finally{if(current())setBusy(false);}
  };
  const save=()=>void act(async current=>{
    await client.save({label,settings:{contact:state.contact,lang:state.lang,agentId:state.agentId},connection:state.connection?.verified?{id:state.connection.connectionId,token:state.connection.phoneToken}:null});
    if(!current())return;const rows=await client.list();if(current()){setEntries(rows);setNote(tr.saved);}
  });
  const restore=(id:string)=>void act(async current=>{
    const saved=await client.restore(id);if(!current())return;
    engine.setConnection(null);engine.clearChat();engine.setContact(saved.settings.contact);engine.setLang(saved.settings.lang);engine.setAgentId(saved.settings.agentId);
    engine.setConnection(saved.connection);engine.setMode(saved.connection || saved.settings.agentId?'live':'offline');setNote(saved.needs_pairing?tr.needsPairing:tr.loaded);
  });
  const remove=(id:string)=>void act(async current=>{await client.remove(id);if(current()){setEntries(rows=>rows.filter(row=>row.id!==id));setNote(tr.removed);}});
  const logout=()=>void act(async current=>{
    await client.logout();
    // Credential cleanup must finish even if the panel closed during signout.
    engine.setConnection(null);engine.setMode('offline');engine.clearChat();
    if(!current())return;setStatus({enabled:true,signed_in:false});setEntries([]);
  });
  return <section className="rounded-xl border bg-card p-4">
    <button type="button" className="flex w-full items-center justify-between text-left text-sm font-semibold" aria-expanded={open} aria-controls="saved-setups-content" onClick={toggle}>{tr.title}<span aria-hidden="true">{open?'−':'+'}</span></button>
    {open && <div id="saved-setups-content" className="mt-3 space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">{tr.help}</p>
      {busy && !status && <p role="status">{tr.loading}</p>}
      {status && !status.enabled && <p role="status">{tr.unavailable}</p>}
      {status?.enabled && !status.signed_in && <form method="post" action="/api/public/v1/account/login"><Button type="submit">{tr.login}</Button></form>}
      {status?.signed_in && <>
        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{tr.signed}</span><Button variant="ghost" size="sm" onClick={logout} disabled={busy}>{tr.out}</Button></div>
        <div><Label htmlFor="saved-setup-name">{tr.name}</Label><Input id="saved-setup-name" value={label} maxLength={80} onChange={event=>setLabel(event.target.value)}/></div>
        <Button onClick={save} disabled={busy || !label.trim() || !!(state.connection && !state.connection.verified)}>{busy?tr.working:tr.save}</Button>
        {state.connection && !state.connection.verified && <p className="text-xs">{tr.pair}</p>}
        <ul className="space-y-2">{entries.map(entry=><li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2"><span className="min-w-0 flex-1 break-words">{entry.label}</span><Button size="sm" variant="outline" aria-label={`${tr.load} ${entry.label}`} disabled={busy} onClick={()=>restore(entry.id)}>{tr.load}</Button><Button size="sm" variant="ghost" aria-label={`${tr.remove} ${entry.label}`} disabled={busy} onClick={()=>remove(entry.id)}>{tr.remove}</Button></li>)}</ul>
        {!entries.length && <p className="text-xs text-muted-foreground">{tr.empty}</p>}
        <p className="text-xs text-muted-foreground">{tr.loadHelp} {tr.removeHelp} {tr.outHelp}</p>
      </>}
      {note && <p role="status" className="text-xs">{note}</p>}{err && <p role="alert" className="text-xs text-destructive">{err}</p>}
    </div>}
  </section>;
}
