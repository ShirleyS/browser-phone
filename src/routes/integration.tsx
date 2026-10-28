import { createFileRoute } from '@tanstack/react-router';
import { useEffect,useState } from 'react';
import { Phone } from '@/components/phone/Phone';
import { usePhoneEngine } from '@/components/phone/usePhone';
import { parseEmbedParams,outbound,PROTOCOL,PROTOCOL_VERSION } from '@/lib/phone/embed';
import { applyIntegrationCommand } from '@/lib/phone/integration';
export const Route=createFileRoute('/integration')({head:()=>({meta:[{title:'Connected test phone — Browser Phone'},{name:'referrer',content:'no-referrer'},{name:'robots',content:'noindex,nofollow'}]}),component:IntegrationPhone});
export function IntegrationPhone(){
 const {engine,state}=usePhoneEngine({isolated:true});const[connection,setConnection]=useState<{origin:string;instance:string}|null>(null);const[problem,setProblem]=useState('Connecting to your app…');
 useEffect(()=>{
  const params=parseEmbedParams(window.location.search);const peer=window.parent!==window?window.parent:window.opener as Window|null;
  if(!peer||!params.parentOrigin||!params.session){setProblem('Open this test phone from Ring Orden’s Phone & agent screen.');return;}
  const origin=params.parentOrigin,session=params.session;let active=true,configured=false;
  const send=(type:string,payload:Record<string,unknown>={})=>{if(!peer.closed)peer.postMessage(outbound(session,type,payload),origin);};
  engine.onOutbound=send;
  const receive=(event:MessageEvent)=>{
   if(!active||event.source!==peer||event.origin!==origin)return;
   const d=event.data as Record<string,unknown>|null;
   if(!d||d['protocol']!==PROTOCOL||d['v']!==PROTOCOL_VERSION||d['session']!==session)return;
   if(!configured&&d['type']!=='configure')return;
   if(!applyIntegrationCommand(engine,d))return;
   if(d['type']==='configure'){configured=true;setConnection({origin,instance:session});setProblem('');send('configured');}
  };
  window.addEventListener('message',receive);send('ready',{capabilities:['external-voice','explicit-messages']});
  const timer=setInterval(()=>{
   if(peer.closed){engine.integrationCallState('error','The connected dashboard was closed.');setConnection(null);setProblem('The connected dashboard was closed. Reopen the phone from Ring Orden.');return;}
   if(!configured)send('ready',{capabilities:['external-voice','explicit-messages']});
  },1000);
  const timeout=setTimeout(()=>{if(!configured)setProblem('Ring Orden has not connected to this phone. Keep the dashboard open and check its phone destination.');},12000);
  return()=>{active=false;clearInterval(timer);clearTimeout(timeout);window.removeEventListener('message',receive);send('call.end.request');engine.onOutbound=undefined;engine.setConnection(null);};
 },[engine]);
 return <main className="min-h-dvh bg-background p-3 text-foreground"><div className="mx-auto max-w-[400px] space-y-3"><header className="space-y-1 text-center"><h1 className="font-semibold">Ring Orden test phone</h1><p className="text-xs text-muted-foreground">Speak through the phone. Messages appear only when your integration sends them.</p>{connection&&<p className="break-all text-xs text-muted-foreground">Connected to {connection.origin} · Instance {connection.instance}</p>}</header>{problem&&<p role="status" className="rounded-lg border p-3 text-sm">{problem}</p>}{connection&&<Phone engine={engine} state={state}/>}</div></main>;
}
