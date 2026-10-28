import type { AccountStore, AccountSession, ConnectionRecord, StoredSetup } from '@/server/account/store';
export class MemoryAccountStore implements AccountStore {
  states=new Map<string,{binding:string;expires:string}>();
  sessions=new Map<string,AccountSession>();
  setups=new Map<string,StoredSetup>();
  connections=new Map<string,ConnectionRecord>();
  async createState(hash:string,binding:string,expires:string) { this.states.set(hash,{binding,expires}); }
  async consumeState(hash:string,binding:string,now:string) { const row=this.states.get(hash);if(!row || row.binding!==binding || row.expires<=now)return false;this.states.delete(hash);return true; }
  async createSession(row:AccountSession) { this.sessions.set(row.token_hash,row); }
  async session(hash:string) { return this.sessions.get(hash)??null; }
  async deleteSession(hash:string) { this.sessions.delete(hash); }
  async list(owner:string) { return [...this.setups.values()].filter(s=>s.owner===owner).map(({id,label,created_at})=>({id,label,created_at})); }
  async get(owner:string,id:string) { const row=this.setups.get(id);return row?.owner===owner?row:null; }
  async save(row:StoredSetup,connectionHash:string|null) {
    if([...this.setups.values()].filter(s=>s.owner===row.owner).length>=20)return 'limit' as const;
    const c=row.connection_id?this.connections.get(row.connection_id):null;
    if(row.connection_id && (!c || !c.verified_at || c.revoked_at || c.token_expires_at<=new Date().toISOString() || c.phone_token_hash!==connectionHash))return 'connection_invalid' as const;
    this.setups.set(row.id,row);return 'saved' as const;
  }
  async remove(owner:string,id:string) { if(this.setups.get(id)?.owner!==owner)return false;return this.setups.delete(id); }
  async connection(id:string) { return this.connections.get(id)??null; }
}
