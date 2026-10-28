import type { SavedSetupSummary } from '@/lib/account/types';
export type AccountSession={token_hash:string;owner:string;expires_at:string};
export type StoredSetup={id:string;owner:string;label:string;payload:string;connection_id:string|null;created_at:string};
export type ConnectionRecord={id:string;webhook_url:string;phone_token_hash:string;verified_at:string|null;revoked_at:string|null;token_expires_at:string};
export interface AccountStore {
  createState(hash:string,binding:string,expires:string):Promise<void>;
  consumeState(hash:string,binding:string,now:string):Promise<boolean>;
  createSession(row:AccountSession):Promise<void>;
  session(hash:string):Promise<AccountSession|null>;
  deleteSession(hash:string):Promise<void>;
  list(owner:string):Promise<SavedSetupSummary[]>;
  get(owner:string,id:string):Promise<StoredSetup|null>;
  save(row:StoredSetup,connectionHash:string|null):Promise<'saved'|'limit'|'connection_invalid'>;
  remove(owner:string,id:string):Promise<boolean>;
  connection(id:string):Promise<ConnectionRecord|null>;
}

