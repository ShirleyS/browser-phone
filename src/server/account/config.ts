export type AccountConfig = { issuer:string; clientId:string; clientSecret:string; origin:string; key:string; secure:boolean };
export const LOGIN_SECONDS = 7 * 24 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
export function readAccountConfig(env:Record<string,string|undefined> = process.env):AccountConfig|null {
  const {MOJOAUTH_ISSUER:issuer,MOJOAUTH_CLIENT_ID:clientId,MOJOAUTH_CLIENT_SECRET:clientSecret,BP_PUBLIC_BASE_URL:base,BP_ACCOUNT_ENCRYPTION_KEY:key}=env;
  if(!issuer || !clientId || !clientSecret || !base || !key || !/^[a-fA-F0-9]{64}$/.test(key)) return null;
  try {
    const provider=new URL(issuer), app=new URL(base);
    if(provider.protocol!=='https:' || provider.username || provider.password || provider.search || provider.hash) return null;
    const local=['localhost','127.0.0.1','[::1]'].includes(app.hostname);
    if((app.protocol!=='https:' && !(local && app.protocol==='http:')) || app.username || app.password || app.pathname!=='/' || app.search || app.hash) return null;
    return {issuer,clientId,clientSecret,origin:app.origin,key,secure:app.protocol==='https:'};
  } catch { return null; }
}
export function accountCookie(cfg:AccountConfig,kind:'session'|'flow') { return `${cfg.secure?'__Host-':''}bp_${kind}`; }

