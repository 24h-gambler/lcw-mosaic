/** Meshing Worker (WP-101, docs/08 6.3): greedy mesh + AO off the main thread. */
import { meshChunk, type GeoBuffers } from './mesher.js';

interface Req {
  id: number;
  key: string;
  vox: Uint16Array;
  origin: [number, number, number];
}

function transfers(g: GeoBuffers): ArrayBuffer[] {
  return [g.position.buffer, g.normal.buffer, g.tile.buffer, g.color.buffer, g.index.buffer] as ArrayBuffer[];
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, key, vox, origin } = ev.data;
  const mesh = meshChunk(vox, origin);
  (self as unknown as Worker).postMessage({ id, key, mesh }, [...transfers(mesh.opaque), ...transfers(mesh.translucent)]);
};
