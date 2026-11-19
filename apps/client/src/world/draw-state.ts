// Whether an object (an NPC's body) is really drawn: attached to the scene, shown itself and through every parent, and
// at least one shown mesh with vertices. The real-play check reads it per NPC (getStats().npcScene) to tell "not drawn"
// (a product fault) from "the bot did not get it on screen" (not checked).
import type * as THREE from 'three';

export function drawState(root: THREE.Object3D, scene: THREE.Object3D): { inScene: boolean; shown: boolean; meshes: number } {
  let shown = root.visible;
  let top: THREE.Object3D = root;
  for (let o = root.parent; o; o = o.parent) {
    shown &&= o.visible;
    top = o;
  }
  let meshes = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    const count = (m.geometry as THREE.BufferGeometry | undefined)?.attributes?.position?.count ?? 0;
    if (m.isMesh && count > 0) meshes++;
  });
  return { inScene: top === scene, shown, meshes };
}
