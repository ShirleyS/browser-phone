import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavedSetups } from '@/components/workbench/SavedSetups';
import type { AccountClient } from '@/lib/account/client';
const settings={contact:{name:'Café',number:'+52 55 91100000'},lang:'en' as const,agentId:''};
const state={...settings,connection:null};
function fixture(signedIn=true) {
  const client:AccountClient={status:vi.fn(async()=>({enabled:true,signed_in:signedIn})),list:vi.fn(async()=>[{id:'saved',label:'My phone',created_at:new Date().toISOString()}]),save:vi.fn(async()=>({id:'new',label:'Café',created_at:new Date().toISOString()})),restore:vi.fn(async()=>({settings,connection:null,needs_pairing:false})),remove:vi.fn(async()=>{}),logout:vi.fn(async()=>{})};
  const engine={setContact:vi.fn(),setLang:vi.fn(),setAgentId:vi.fn(),setConnection:vi.fn(),setMode:vi.fn(),clearChat:vi.fn(),startCall:vi.fn()};
  return {client,engine};
}
describe('optional saved setup UI',()=>{
  it('does not contact account services until opened and keeps login an explicit POST form',async()=>{
    const f=fixture(false);render(<SavedSetups engine={f.engine} state={state} client={f.client}/>);
    expect(f.client.status).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    const login=await screen.findByRole('button',{name:'Sign in to save'});
    expect(login.closest('form')).toHaveAttribute('method','post');expect(login.closest('form')).toHaveAttribute('action','/api/public/v1/account/login');
    expect(screen.getByText(/use the phone without signing in/i)).toBeInTheDocument();
  });
  it('explains unavailable login without blocking the phone',async()=>{
    const f=fixture();f.client.status=vi.fn(async()=>({enabled:false,signed_in:false,reason:'not_configured' as const}));
    render(<SavedSetups engine={f.engine} state={state} client={f.client}/>);fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    expect(await screen.findByText(/Saving is not available on this deployment yet/)).toBeInTheDocument();expect(f.client.list).not.toHaveBeenCalled();
  });
  it('saves only approved settings and restores without starting a call',async()=>{
    const f=fixture();const connection={apiBase:'https://phone.test/api/public/v1',connectionId:'paired',webhookUrl:'https://hooks.test',phoneToken:'private-connection',signingSecret:'never-store-this',verified:true};
    render(<SavedSetups engine={f.engine} state={{...state,connection}} client={f.client}/>);fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    await screen.findByText('My phone');fireEvent.click(screen.getByRole('button',{name:'Save current setup'}));
    await waitFor(()=>expect(f.client.save).toHaveBeenCalled());expect(JSON.stringify(vi.mocked(f.client.save).mock.calls)).not.toContain('never-store-this');
    fireEvent.click(screen.getByRole('button',{name:'Load My phone'}));await waitFor(()=>expect(f.engine.setContact).toHaveBeenCalledWith(settings.contact));
    expect(f.engine.startCall).not.toHaveBeenCalled();expect(f.engine.clearChat).toHaveBeenCalled();
  });
  it('removes only the saved copy and signs out without global connection revocation',async()=>{
    const f=fixture();render(<SavedSetups engine={f.engine} state={state} client={f.client}/>);fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    await screen.findByText('My phone');fireEvent.click(screen.getByRole('button',{name:'Remove My phone'}));await waitFor(()=>expect(f.client.remove).toHaveBeenCalledWith('saved'));
    expect(f.engine.setConnection).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Sign out'}));
    await waitFor(()=>expect(f.engine.setConnection).toHaveBeenCalledWith(null));expect(f.engine.setMode).toHaveBeenCalledWith('offline');
  });
  it('does not apply a restore that completes after the panel closes',async()=>{
    const f=fixture();let finish!:(v:Awaited<ReturnType<AccountClient['restore']>>)=>void;
    f.client.restore=vi.fn(()=>new Promise<Awaited<ReturnType<AccountClient['restore']>>>(resolve=>{finish=resolve;}));
    render(<SavedSetups engine={f.engine} state={state} client={f.client}/>);fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    await screen.findByText('My phone');fireEvent.click(screen.getByRole('button',{name:'Load My phone'}));fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    finish({settings,connection:null,needs_pairing:false});await waitFor(()=>expect(f.client.restore).toHaveBeenCalled());expect(f.engine.setContact).not.toHaveBeenCalled();
  });
  it.each(['collapse','unmount'])('clears the phone when signout completes after %s',async close=>{
    const f=fixture();let finish!:()=>void;
    f.client.logout=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const view=render(<SavedSetups engine={f.engine} state={state} client={f.client}/>);
    fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));
    await screen.findByText('My phone');fireEvent.click(screen.getByRole('button',{name:'Sign out'}));
    if(close==='collapse')fireEvent.click(screen.getByRole('button',{name:'Save my setup (optional)'}));else view.unmount();
    finish();await waitFor(()=>expect(f.engine.setConnection).toHaveBeenCalledWith(null));
    expect(f.engine.clearChat).toHaveBeenCalled();expect(f.engine.setMode).toHaveBeenCalledWith('offline');
  });
});
