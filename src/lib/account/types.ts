import { z } from 'zod';
import type { LiveConnection } from '@/lib/phone/types';
export const settingsSchema=z.object({contact:z.object({name:z.string().min(1).max(128),number:z.string().min(1).max(64)}).strict(),lang:z.enum(['en','es']),agentId:z.string().max(128)}).strict();
export const saveSetupSchema=z.object({label:z.string().trim().min(1).max(80),settings:settingsSchema,connection:z.object({id:z.string().uuid(),token:z.string().regex(/^bp_conn_[A-Za-z0-9_-]{43}$/)}).strict().nullable().default(null)}).strict();
export type SetupSettings=z.infer<typeof settingsSchema>;
export type SaveSetupInput=z.infer<typeof saveSetupSchema>;
export type SavedSetupSummary={id:string;label:string;created_at:string};
export type RestoredSetup={settings:SetupSettings;connection:LiveConnection|null;needs_pairing:boolean};
export type AccountStatus={enabled:boolean;signed_in:boolean;reason?:'not_configured'|'unavailable'};
