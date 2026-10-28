// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readAccountConfig } from '@/server/account/config';
import { seal, openSealed } from '@/server/account/crypto';

const env = { MOJOAUTH_ISSUER:'https://login.example.mojoauth.com', MOJOAUTH_CLIENT_ID:'phone', MOJOAUTH_CLIENT_SECRET:'test-only-secret', BP_PUBLIC_BASE_URL:'https://phone.example.com', BP_ACCOUNT_ENCRYPTION_KEY:'ab'.repeat(32) };
describe('optional account configuration',()=>{
  it('stays disabled without complete valid configuration',()=>{
    expect(readAccountConfig({})).toBeNull();
    for(const field of Object.keys(env)) expect(readAccountConfig({...env,[field]:''})).toBeNull();
    expect(readAccountConfig({...env,BP_ACCOUNT_ENCRYPTION_KEY:'password'})).toBeNull();
    expect(readAccountConfig({...env,MOJOAUTH_ISSUER:'http://login.example.com'})).toBeNull();
    expect(readAccountConfig({...env,BP_PUBLIC_BASE_URL:'http://phone.example.com'})).toBeNull();
    expect(readAccountConfig({...env,BP_PUBLIC_BASE_URL:'https://phone.example.com/other?x=1'})).toBeNull();
  });
  it('requires secure host-only cookies in production and permits localhost development',()=>{
    expect(readAccountConfig(env)).toMatchObject({secure:true,origin:'https://phone.example.com'});
    expect(readAccountConfig({...env,BP_PUBLIC_BASE_URL:'http://127.0.0.1:5192'})).toMatchObject({secure:false});
  });
});
describe('private saved setup encryption',()=>{
  it('round trips Unicode settings without plaintext credentials and uses fresh IVs',async()=>{
    const value={name:'Café',connectionToken:'bp_conn_private_test_token'};
    const a=await seal(value,env.BP_ACCOUNT_ENCRYPTION_KEY,'owner-a:record-1');
    const b=await seal(value,env.BP_ACCOUNT_ENCRYPTION_KEY,'owner-a:record-1');
    expect(a).not.toBe(b);expect(a).not.toContain(value.connectionToken);
    expect(await openSealed(a,env.BP_ACCOUNT_ENCRYPTION_KEY,'owner-a:record-1')).toEqual(value);
  });
  it('rejects a swapped owner/record, wrong key or modified ciphertext',async()=>{
    const sealed=await seal({token:'private'},env.BP_ACCOUNT_ENCRYPTION_KEY,'owner-a:record-1');
    await expect(openSealed(sealed,env.BP_ACCOUNT_ENCRYPTION_KEY,'owner-b:record-1')).rejects.toThrow();
    await expect(openSealed(sealed,'cd'.repeat(32),'owner-a:record-1')).rejects.toThrow();
    const parts=sealed.split('.');parts[2]=(parts[2]![0]==='A'?'B':'A')+parts[2]!.slice(1);
    await expect(openSealed(parts.join('.'),env.BP_ACCOUNT_ENCRYPTION_KEY,'owner-a:record-1')).rejects.toThrow();
  });
});
