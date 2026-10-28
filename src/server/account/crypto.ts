const encoder=new TextEncoder();
function encode(bytes:Uint8Array) { return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function decode(value:string) {
  if(!/^[A-Za-z0-9_-]+$/.test(value) || value.length>32000) throw new Error('Invalid encrypted setup');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
async function keyFrom(hex:string) {
  if(!/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw',Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function seal(value:unknown,key:string,aad:string):Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},await keyFrom(key),encoder.encode(JSON.stringify(value)));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function openSealed<T=unknown>(value:string,key:string,aad:string):Promise<T> {
  const parts=value.split('.');
  if(parts.length!==3 || parts[0]!=='v1') throw new Error('Invalid encrypted setup');
  const iv=decode(parts[1]!); if(iv.length!==12) throw new Error('Invalid encrypted setup');
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},await keyFrom(key),decode(parts[2]!));
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decrypted)) as T;
}

