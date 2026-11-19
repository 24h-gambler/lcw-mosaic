// drawState (world/draw-state.ts): the real-play check tells an NPC that is not drawn from one the bot missed.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { drawState } from '../draw-state.js';

const body = () => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  return root;
};

describe('drawState', () => {
  it('an NPC body in the scene, shown, with a mesh is drawn', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const root = body();
    group.add(root);
    scene.add(group);
    expect(drawState(root, scene)).toEqual({ inScene: true, shown: true, meshes: 1 });
  });

  it('not attached, hidden through a parent, or with no vertices is not drawn', () => {
    const scene = new THREE.Scene();
    expect(drawState(body(), scene).inScene).toBe(false);
    const group = new THREE.Group();
    const root = body();
    group.add(root);
    scene.add(group);
    group.visible = false;
    expect(drawState(root, scene).shown).toBe(false);
    group.visible = true;
    root.children[0]!.visible = false;
    expect(drawState(root, scene).meshes).toBe(0);
    const empty = new THREE.Group();
    empty.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    scene.add(empty);
    expect(drawState(empty, scene).meshes).toBe(0);
  });
});
