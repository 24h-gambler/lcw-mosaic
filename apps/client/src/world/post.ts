/**
 * Post-processing (R2627, high tier only): bloom on the bright parts (lanterns, lit windows, the sun's glint on water)
 * and a light colour grade (contrast, a touch of warmth, vignette) after ACES tone mapping. Lower tiers render straight
 * to the screen with the same tone mapping in their materials, so the look matches without the extra passes.
 *
 * Cost on the high tier: the scene renders into one half-float target, bloom runs on a half-resolution mip chain
 * (UnrealBloomPass, 3 levels), the grade is one full-screen pass that also does the tone mapping and sRGB output.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uVignette: { value: 0.22 }, uWarm: { value: 0.03 }, uContrast: { value: 1.06 } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uVignette;
uniform float uWarm;
uniform float uContrast;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  // works on linear HDR before the output pass: gentle contrast around mid grey, warm highlights, vignette
  vec3 col = c.rgb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.04);
  col = pow(max(col, 0.0), vec3(uContrast)) * (0.18 / pow(0.18, uContrast));
  col *= vec3(1.0 + uWarm, 1.0, 1.0 - uWarm);
  vec2 d = vUv - 0.5;
  col *= 1.0 - uVignette * dot(d, d) * 2.0;
  gl_FragColor = vec4(col, c.a);
}`
};

export class PostChain {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // strength, radius, threshold (linear HDR: only lamps, glints and the sun disc go over ~1.1)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.55, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GRADE));
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    // every pass's own materials and targets (the grade and output quads), not only the composer's targets
    for (const p of this.composer.passes) (p as { dispose?: () => void }).dispose?.();
    this.composer.dispose();
  }
}
