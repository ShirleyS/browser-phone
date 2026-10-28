import { createFileRoute } from '@tanstack/react-router';
import { accountHandlers } from '@/server/account/handlers';
export const Route=createFileRoute('/api/public/v1/account/setups/$id/restore')({server:{handlers:{POST:({request,params})=>accountHandlers.restoreSetup(request,params.id)}}});
