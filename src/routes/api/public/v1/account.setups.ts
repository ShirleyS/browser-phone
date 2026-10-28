import { createFileRoute } from '@tanstack/react-router';
import { accountHandlers } from '@/server/account/handlers';
export const Route=createFileRoute('/api/public/v1/account/setups')({server:{handlers:{GET:({request})=>accountHandlers.listSetups(request),POST:({request})=>accountHandlers.saveSetup(request)}}});
