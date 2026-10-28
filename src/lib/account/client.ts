import { boundedText } from '@/lib/shared/body';
import type { AccountStatus, RestoredSetup, SavedSetupSummary, SaveSetupInput } from './types';
export interface AccountClient {
  status():Promise<AccountStatus>;list():Promise<SavedSetupSummary[]>;
  save(input:SaveSetupInput):Promise<SavedSetupSummary>;
  restore(id:string):Promise<RestoredSetup>;remove(id:string):Promise<void>;logout():Promise<void>;
}
const base='/api/public/v1/account';
async function request<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch(base+path,{method,credentials:'same-origin',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=JSON.parse(await boundedText(response.body,65536)) as T & {error?:{message?:string}};
  if(!response.ok)throw new Error(result.error?.message??'Saved setups are unavailable. Please try again.');return result;
}
export const accountClient:AccountClient={
  status:()=>request(''),list:async()=>(await request<{setups:SavedSetupSummary[]}>('/setups')).setups,
  save:input=>request('/setups','POST',input),restore:id=>request('/setups/'+encodeURIComponent(id)+'/restore','POST'),
  remove:async id=>{await request('/setups/'+encodeURIComponent(id)+'/remove','POST');},logout:async()=>{await request('/logout','POST');},
};
