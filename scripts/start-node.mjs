// Run via `node --import tsx scripts/start-node.mjs` after build:node.
import { installPinnedOutbound } from './pinned-outbound.mjs';
installPinnedOutbound();
await import('../.output/server/index.mjs');