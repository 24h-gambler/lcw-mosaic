// Wrangler entry. workerd only accepts handler exports here (default handler + Durable Object classes),
// so all helpers and constants live in platform.ts.
import { PlatformDO, workerHandler } from './platform.js';
import { WorldRoomDO } from './room.js';

export { PlatformDO, WorldRoomDO };
export default workerHandler;
