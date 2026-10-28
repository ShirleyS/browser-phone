import { createFileRoute } from '@tanstack/react-router';
import { accountHandlers } from '@/server/account/handlers';
export const Route=createFileRoute('/api/public/v1/account')({server:{handlers:{GET:({request})=>accountHandlers.accountStatus(request)}}});
