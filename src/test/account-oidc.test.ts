// @vitest-environment node
import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMojoOidc } from '@/server/account/oidc';
import type { AccountConfig } from '@/server/account/config';
const issuer='https://identity.example.mojoauth.com';
const cfg:AccountConfig={issuer,clientId:'phone-client',clientSecret:'test-secret',origin:'https://phone.example.com',key:'ab'.repeat(32),secure:true};
const flow={state:'s'.repeat(43),nonce:'n'.repeat(43),verifier:'v'.repeat(43),expiresAt:Date.now()+600000};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
function fixture(overrides:Record<string,unknown>={},tampered=false) {
  let exchanged=false;
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);
    if(url.endsWith('/.well-known/openid-configuration')) return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256']});
    if(url.endsWith('/jwks')) return Response.json({keys:[jwk]});
    if(url.endsWith('/token')) {
      expect(String(init?.body)).toContain('code_verifier='+flow.verifier);exchanged=true;
      const payload={iss:issuer,sub:'person-1',aud:cfg.clientId,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce:flow.nonce,...overrides};
      const unsigned=[Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url')].join('.');
      const signature=createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
      return Response.json({access_token:'test-only-access',token_type:'Bearer',id_token:unsigned+'.'+(tampered?'A'.repeat(signature.length):signature)});
    }
    throw new Error('Unexpected provider request');
  };
  return {provider:createMojoOidc(cfg,fetcher),exchanged:()=>exchanged};
}
describe('actual OIDC protocol adapter',()=>{
  it('uses PKCE, state, nonce and validates a signed ID token',async()=>{
    const f=fixture();const target=new URL(await f.provider.authorize(flow));
    expect(target.origin).toBe(issuer);expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('nonce')).toBe(flow.nonce);expect(target.searchParams.get('state')).toBe(flow.state);
    expect(target.searchParams.get('redirect_uri')).toBe(cfg.origin+'/api/public/v1/account/callback');
    expect(await f.provider.authenticate(new URL(cfg.origin+'/api/public/v1/account/callback?code=test-code&state='+flow.state),flow)).toEqual({issuer,subject:'person-1'});
  });
  it.each([{iss:'https://attacker.test'},{aud:'other-client'},{nonce:'wrong'},{exp:1}])('rejects invalid ID token claims %j',async overrides=>{
    const f=fixture(overrides);
    await expect(f.provider.authenticate(new URL(cfg.origin+'/api/public/v1/account/callback?code=test-code&state='+flow.state),flow)).rejects.toThrow();
  });
  it('rejects forged signatures and incorrect state',async()=>{
    const f=fixture({},true);
    await expect(f.provider.authenticate(new URL(cfg.origin+'/api/public/v1/account/callback?code=test-code&state='+flow.state),flow)).rejects.toThrow();
    const other=fixture();
    await expect(other.provider.authenticate(new URL(cfg.origin+'/api/public/v1/account/callback?code=test-code&state=wrong'),flow)).rejects.toThrow();
    expect(other.exchanged()).toBe(false);
  });
});
