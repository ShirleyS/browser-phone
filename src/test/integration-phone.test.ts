import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {PhoneEngine,type Deps} from '@/lib/phone/engine';
import {applyIntegrationCommand} from '@/lib/phone/integration';
function fixture(){let id=0;const events:{type:string;payload:unknown}[]=[];const deps:Deps={fetch:vi.fn(),now:Date.now,setTimeout,clearTimeout,uuid:()=>String(++id),getUserMedia:vi.fn(),startVoice:vi.fn()};const engine=new PhoneEngine(deps);engine.onOutbound=(type,payload)=>events.push({type,payload});return{engine,deps,events};}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('routes a handset call to its integration without simulated connection or a second microphone',async()=>{const{engine,deps,events}=fixture();applyIntegrationCommand(engine,{type:'configure',contact:{name:'Ring Orden',number:'+52 55 91100000'},lang:'en'});engine.startCall();await vi.advanceTimersByTimeAsync(3000);expect(events.some(e=>e.type==='call.request')).toBe(true);expect(engine.state.call.status).toBe('outgoing');expect(deps.fetch).not.toHaveBeenCalled();expect(deps.getUserMedia).not.toHaveBeenCalled();applyIntegrationCommand(engine,{type:'call.state',status:'active'});expect(engine.state.call).toMatchObject({live:true,status:'active'});await engine.dispose();});
it('shows only explicit real messages and waits for text acknowledgements',async()=>{const{engine,events}=fixture();applyIntegrationCommand(engine,{type:'configure',contact:{name:'Ring Orden',number:'fake'},lang:'en'});await engine.sendMessage('hello');expect(engine.state.chat[0]).toMatchObject({from:'me',status:'sending',simulated:false});const event=events.find(e=>e.type==='message.request')!;const id=(event.payload as {id:string}).id;applyIntegrationCommand(engine,{type:'message.ack',id,ok:true});await vi.advanceTimersByTimeAsync(4000);expect(engine.state.chat).toHaveLength(1);expect(engine.state.chat[0]!.status).toBe('sent');applyIntegrationCommand(engine,{type:'message.received',id:'receipt',text:'Your order',link:{label:'Receipt',url:'https://ringorden.lovable.app/customer'}});expect(engine.state.chat[1]).toMatchObject({from:'them',simulated:false,link:{label:'Receipt'}});await engine.dispose();});
it('rejects unknown call states and unsafe links without changing the conversation',()=>{const{engine}=fixture();expect(applyIntegrationCommand(engine,{type:'call.state',status:'anything'})).toBe(false);expect(applyIntegrationCommand(engine,{type:'message.received',id:'bad',text:'bad',link:{label:'bad',url:'javascript:alert(1)'}})).toBe(false);expect(engine.state.chat).toHaveLength(0);});
it('ends on an actual integration error rather than simulating a call',async()=>{const{engine}=fixture();applyIntegrationCommand(engine,{type:'configure',contact:{name:'Ring Orden',number:'fake'},lang:'en'});engine.startCall();applyIntegrationCommand(engine,{type:'call.state',status:'error',message:'Microphone access timed out'});expect(engine.state.call.status).toBe('ended');expect(engine.state.banner).toBe('Microphone access timed out');await engine.dispose();});

it('synchronizes handset mute with the actual parent microphone state',async()=>{const{engine}=fixture();applyIntegrationCommand(engine,{type:'configure',contact:{name:'Ring Orden',number:'fake'},lang:'en'});engine.startCall();applyIntegrationCommand(engine,{type:'call.state',status:'active',muted:false});engine.toggleMute();expect(engine.state.call.muted).toBe(true);applyIntegrationCommand(engine,{type:'call.state',status:'active',muted:false});expect(engine.state.call.muted).toBe(false);await engine.dispose();});

it('configuration retries preserve an active call and delivered receipt history',async()=>{
 const {engine}=fixture();
 const config={type:'configure',contact:{name:'Ring Orden',number:'fake'},lang:'en'};
 applyIntegrationCommand(engine,config);
 engine.startCall();
 applyIntegrationCommand(engine,{type:'call.state',status:'active'});
 applyIntegrationCommand(engine,{type:'message.received',id:'receipt-once',text:'Your confirmed order'});
 const call=engine.state.call;
 applyIntegrationCommand(engine,config);
 expect(engine.state.call).toEqual(call);
 expect(engine.state.chat).toMatchObject([{id:'receipt-once',text:'Your confirmed order'}]);
 await engine.dispose();
});
