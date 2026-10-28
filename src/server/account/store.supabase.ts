import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { admin } from '@/server/bp/core';
import type { AccountSession, AccountStore, StoredSetup } from './store';
type StateRow={state_hash:string;binding_hash:string;expires_at:string};
type Table<T>={Row:T;Insert:T;Update:Partial<T>;Relationships:[]};
type AccountDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Tables'|'Functions'> & {
  Tables:Database['public']['Tables'] & {bp_account_states:Table<StateRow>;bp_account_sessions:Table<AccountSession>;bp_account_setups:Table<StoredSetup>};
  Functions:Database['public']['Functions'] & {bp_save_account_setup:{Args:{_id:string;_owner:string;_label:string;_payload:string;_connection_id:string|null;_connection_hash:string|null};Returns:string}};
}};
function checked<T>(result:{data:T;error:unknown}):T {if(result.error)throw new Error('Account store unavailable');return result.data;}
export async function createAccountStore():Promise<AccountStore> {
  // Extend generated types locally; generated integration files stay untouched.
  const db=await admin() as unknown as SupabaseClient<AccountDatabase>;
  return {
    async createState(state_hash,binding_hash,expires_at) {checked(await db.from('bp_account_states').insert({state_hash,binding_hash,expires_at}));},
    async consumeState(hash,binding,now) {return !!checked(await db.from('bp_account_states').delete().eq('state_hash',hash).eq('binding_hash',binding).gt('expires_at',now).select('state_hash'))?.length;},
    async createSession(row) {checked(await db.from('bp_account_sessions').insert(row));},
    async session(hash) {return checked(await db.from('bp_account_sessions').select('token_hash,owner,expires_at').eq('token_hash',hash).maybeSingle());},
    async deleteSession(hash) {checked(await db.from('bp_account_sessions').delete().eq('token_hash',hash));},
    async list(owner) {return checked(await db.from('bp_account_setups').select('id,label,created_at').eq('owner',owner).order('created_at',{ascending:false}))??[];},
    async get(owner,id) {return checked(await db.from('bp_account_setups').select('*').eq('owner',owner).eq('id',id).maybeSingle());},
    async save(row,hash) {
      const result=checked(await db.rpc('bp_save_account_setup',{_id:row.id,_owner:row.owner,_label:row.label,_payload:row.payload,_connection_id:row.connection_id,_connection_hash:hash}));
      if(result!=='saved' && result!=='limit' && result!=='connection_invalid')throw new Error('Account store unavailable');return result;
    },
    async remove(owner,id) {return !!checked(await db.from('bp_account_setups').delete().eq('owner',owner).eq('id',id).select('id'))?.length;},
    async connection(id) {return checked(await db.from('bp_connections').select('id,webhook_url,phone_token_hash,verified_at,revoked_at,token_expires_at').eq('id',id).maybeSingle());},
  };
}
