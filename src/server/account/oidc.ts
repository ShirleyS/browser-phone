import * as oidc from 'openid-client';
import type { AccountConfig } from './config';
import { boundedText } from '@/lib/shared/body';
export type LoginFlow={state:string;nonce:string;verifier:string;expiresAt:number};
export interface IdentityProvider {
  authorize(flow:LoginFlow):Promise<string>;
  authenticate(callback:URL,flow:LoginFlow):Promise<{issuer:string;subject:string}>;
}
export function createMojoOidc(cfg:AccountConfig,fetcher:typeof fetch=fetch):IdentityProvider {
  let pending:Promise<oidc.Configuration>|undefined;
  const load=()=>pending??=(async()=>{
    const client=await oidc.discovery(new URL(cfg.issuer),cfg.clientId,{id_token_signed_response_alg:'RS256'},oidc.ClientSecretBasic(cfg.clientSecret),{
      timeout:8,execute:[oidc.enableNonRepudiationChecks],
      [oidc.customFetch]:async(url,init)=>{
        const {body:requestBody,signal,...options}=init;
        const bodyInit=requestBody instanceof Uint8Array?new Uint8Array(requestBody).buffer:requestBody;
        const response=await fetcher(url,{...options,...(bodyInit===undefined?{}:{body:bodyInit}),...(signal?{signal}:{}),redirect:'error'});
        const body=await boundedText(response.body,65536);
        return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,headers:response.headers});
      },
    });
    return client;
  })().catch(error=>{pending=undefined;throw error;});
  return {
    async authorize(flow) {
      return oidc.buildAuthorizationUrl(await load(),{redirect_uri:cfg.origin+'/api/public/v1/account/callback',scope:'openid email',response_type:'code',code_challenge:await oidc.calculatePKCECodeChallenge(flow.verifier),code_challenge_method:'S256',state:flow.state,nonce:flow.nonce}).href;
    },
    async authenticate(callback,flow) {
      const tokens=await oidc.authorizationCodeGrant(await load(),callback,{pkceCodeVerifier:flow.verifier,expectedState:flow.state,expectedNonce:flow.nonce,idTokenExpected:true});
      const claims=tokens.claims();
      if(!claims || typeof claims.iss!=='string' || typeof claims.sub!=='string' || !claims.sub || claims.sub.length>256) throw new Error('Invalid identity');
      return {issuer:claims.iss,subject:claims.sub};
    },
  };
}
