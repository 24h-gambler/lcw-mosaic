/**
 * Block materials. Two variants share one texel + toy-bevel snippet:
 *  - `fast` (low/mid tiers): a small ShaderMaterial lit per vertex (hemisphere + sun + baked AO), linear fog.
 *    Block faces are flat, so per-vertex light is exact and the fragment cost is one texture read.
 *  - `lit` (high tier): MeshLambertMaterial with the same snippet injected, so it can receive sun shadows.
 * The bevel darkens/lightens each block's edges in face space: every block reads as a rounded painted toy cube
 * (docs/08 1장) instead of a seamless pixel texture.
 */
import * as THREE from 'three';
import { TILE_NAMES, type TileName } from './blocks.js';
import { tileBevel } from './atlas.js';

export const BEVEL_TABLE: Float32Array = Float32Array.from(TILE_NAMES, (n) => tileBevel(n as TileName));

const TEXEL_GLSL = /* glsl */ `
vec4 lcwTexel(vec3 tile) {
  vec2 tuv = tile.xy;
  vec2 f = clamp(fract(tuv), 0.002, 0.998);
  vec4 tex = textureGrad(uAtlas, vec3(f, tile.z), dFdx(tuv), dFdy(tuv));
  float b = uBevel[int(tile.z + 0.5)];
  // highlight top/left edges, shade bottom/right ones, lift the middle: a soft rounded toy face
  float hl = max(1.0 - smoothstep(0.0, 0.09, 1.0 - f.y), 1.0 - smoothstep(0.0, 0.09, f.x));
  float sh = max(1.0 - smoothstep(0.0, 0.09, f.y), 1.0 - smoothstep(0.0, 0.09, 1.0 - f.x));
  float pillow = 1.0 - dot(f - 0.5, f - 0.5) * 0.9;
  tex.rgb *= 1.0 + b * (0.12 * hl - 0.2 * sh + 0.05 * (pillow - 0.8));
  return tex;
}`;

const FAST_VERT = /* glsl */ `
attribute vec4 aTile;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vTile;
varying float vGlow;
varying vec3 vLight;
varying float vFog;
void main() {
  vec3 n = normalize(normal);
  vec3 hemi = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 light = (hemi + uSunCol * max(dot(n, uSunDir), 0.0)) * (1.0 / 3.14159265);
  #ifdef USE_COLOR
  light *= color;
  #endif
  vLight = light;
  vTile = aTile.xyz;
  vGlow = aTile.w;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFog = smoothstep(uFogNear, uFogFar, length(mv.xyz));
}`;

function fastFrag(translucent: boolean, tiles: number): string {
  return /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uBevel[${tiles}];
uniform vec3 uFogCol;
varying vec3 vTile;
varying float vGlow;
varying vec3 vLight;
varying float vFog;
${TEXEL_GLSL}
void main() {
  vec4 tex = lcwTexel(vTile);
  ${translucent ? 'if (tex.a < 0.02) discard;' : 'if (tex.a < 0.5) discard;'}
  vec3 c = tex.rgb * vLight + tex.rgb * vGlow * 0.85;
  c = mix(c, uFogCol, vFog);
  gl_FragColor = vec4(c, ${translucent ? 'tex.a' : '1.0'});
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
}

export interface BlockMaterials {
  opaque: THREE.Material;
  translucent: THREE.Material;
  /** copy light/fog state from the scene each frame (fast variant; no-op for lit) */
  sync(sky: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; sunDir: THREE.Vector3; fog: THREE.Fog }): void;
  mode: 'fast' | 'lit';
}

export function makeBlockMaterials(atlas: THREE.DataArrayTexture, mode: 'fast' | 'lit'): BlockMaterials {
  if (mode === 'lit') {
    const lit = (translucent: boolean): THREE.MeshLambertMaterial => {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: translucent, depthWrite: !translucent });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uAtlas = { value: atlas };
        shader.uniforms.uBevel = { value: BEVEL_TABLE };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 aTile;\nvarying vec3 vTile;\nvarying float vGlow;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile.xyz;\nvGlow = aTile.w;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>\nuniform highp sampler2DArray uAtlas;\nuniform float uBevel[${BEVEL_TABLE.length}];\nvarying vec3 vTile;\nvarying float vGlow;\n${TEXEL_GLSL}`
          )
          .replace(
            '#include <map_fragment>',
            `vec4 texel = lcwTexel(vTile);\n${translucent ? 'if (texel.a < 0.02) discard;' : 'if (texel.a < 0.5) discard;'}\ndiffuseColor *= texel;`
          )
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 0.85;');
      };
      mat.customProgramCacheKey = () => (translucent ? 'lcw-block-lit-t' : 'lcw-block-lit-o');
      return mat;
    };
    return { opaque: lit(false), translucent: lit(true), sync: () => undefined, mode };
  }
  const uniforms = {
    uAtlas: { value: atlas },
    uBevel: { value: BEVEL_TABLE },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uSkyCol: { value: new THREE.Color(1, 1, 1) },
    uGroundCol: { value: new THREE.Color(0.5, 0.4, 0.3) },
    uFogCol: { value: new THREE.Color(1, 1, 1) },
    uFogNear: { value: 50 },
    uFogFar: { value: 100 }
  };
  const fast = (translucent: boolean): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: FAST_VERT,
      fragmentShader: fastFrag(translucent, BEVEL_TABLE.length),
      vertexColors: true,
      transparent: translucent,
      depthWrite: !translucent
    });
  return {
    opaque: fast(false),
    translucent: fast(true),
    mode,
    sync(sky) {
      uniforms.uSunDir.value.copy(sky.sunDir);
      uniforms.uSunCol.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity);
      uniforms.uSkyCol.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity);
      uniforms.uGroundCol.value.copy(sky.hemi.groundColor).multiplyScalar(sky.hemi.intensity);
      uniforms.uFogCol.value.copy(sky.fog.color);
      uniforms.uFogNear.value = sky.fog.near;
      uniforms.uFogFar.value = sky.fog.far;
    }
  };
}
