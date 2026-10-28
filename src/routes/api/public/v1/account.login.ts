import { createFileRoute } from '@tanstack/react-router';
import { accountHandlers } from '@/server/account/handlers';
export const Route=createFileRoute('/api/public/v1/account/login')({server:{handlers:{POST:({request})=>accountHandlers.beginLogin(request)}}});
