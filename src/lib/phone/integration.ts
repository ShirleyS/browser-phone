import { z } from 'zod';
import type { PhoneEngine } from './engine';
const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), contact: z.object({name:z.string().min(1).max(60),number:z.string().min(1).max(30)}), lang:z.enum(['en','es']) }),
  z.object({ type: z.literal('call.state'), status:z.enum(['idle','connecting','active','ended','error']), error:z.string().max(1000).optional(),message:z.string().max(1000).optional(),muted:z.boolean().optional() }),
  z.object({ type: z.literal('message.ack'), id:z.string().min(1).max(128), ok:z.boolean() }),
  z.object({ type: z.literal('message.received'), id:z.string().min(1).max(128), text:z.string().max(4000),link:z.object({label:z.string().min(1).max(80),url:z.string().url().max(2048).refine(value=>new URL(value).protocol==='https:')}).optional() }),
]);
export function applyIntegrationCommand(engine:PhoneEngine,value:unknown):boolean {
  const result=command.safeParse(value);if(!result.success)return false;const c=result.data;
  if(c.type==='configure')engine.configureIntegration(c.contact,c.lang);
  else if(c.type==='call.state')engine.integrationCallState(c.status,c.error??c.message,c.muted);
  else if(c.type==='message.ack')engine.integrationAck(c.id,c.ok);
  else engine.integrationMessage(c.id,c.text,c.link);
  return true;
}
