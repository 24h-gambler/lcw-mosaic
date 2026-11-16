/**
 * Block materials (R2627 realism). One lighting model in three costs:
 *
 *  - `fast` (low tier): light per vertex — sun, sky hemisphere and the voxel light (mesher: r = AO, g = sky light,
 *    b = lamp light) — and one texture read per pixel. Block faces are flat, so per-vertex light is exact for them.
 *  - `fine` (mid tier): the same light per pixel with the material atlas: normal map, roughness/metal specular for the
 *    sun and a sky reflection, two texture reads per pixel.
 *  - `lit` (high tier, or shadows switched on): MeshStandardMaterial (physically based, receives the sun's shadow
 *    map) with the same atlas, the voxel light and the sky occlusion injected.
 *
 * All three: foliage and plants move in the wind, water gets moving ripples, fresnel reflection and the sun's glint,
 * interiors are lit by what comes through doors and windows (sky light) and by lanterns (block light), fog takes the
 * horizon colour and brightens toward the sun. Tone mapping (ACES) is the renderer's, so every material shares it.
 */
import * as THREE from 'three';
import { TILE_NAMES, type TileName } from './blocks.js';

export type BlockMaterialMode = 'fast' | 'fine' | 'lit';

/** Wind per tile layer: 1 = a plant (sways at the top), 0.5 = leaves (whole block breathes), 0 = still. */
export const WIND_TABLE: Float32Array = Float32Array.from(TILE_NAMES, (n) =>
  n === 'leaves' ? 0.5 : n === 'tall_grass' || n === 'flower_red' || n === 'flower_yellow' || n === 'flower_blue' ? 1 : 0
);
export const WATER_LAYER = (TILE_NAMES as readonly TileName[]).indexOf('water');
/** Warm lantern light (linear RGB, before the level curve). */
export const LAMP_COLOR = new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(2.1);

/** Shared GLSL: wind, the voxel light curves and the lighting of a block surface without the shadow map. */
const COMMON_GLSL = /* glsl */ `
uniform float uWind[${TILE_NAMES.length}];
uniform float uTime;
uniform float uWaterLayer;
uniform vec3 uLampCol;
float lcwSkyB(float s) { return max(0.025, pow(0.8, 15.0 * (1.0 - s))); }
float lcwLampB(float b) { return b > 0.0 ? pow(0.76, 15.0 * (1.0 - b)) : 0.0; }
/** direct sun reaches places open to the sky (no shadow map): roofs and rooms keep it out */
float lcwSunVis(vec3 vox) { return smoothstep(0.78, 0.97, vox.g) * mix(0.55, 1.0, vox.r); }
float lcwIsWater(vec3 tile) { return abs(tile.z - uWaterLayer) < 0.5 ? 1.0 : 0.0; }
`;

const WIND_GLSL = /* glsl */ `
vec3 lcwWind(vec3 p, vec4 tile, mat4 model) {
  float w = uWind[int(tile.z + 0.5)];
  if (w <= 0.0) return p;
  vec3 wp = (model * vec4(p, 1.0)).xyz;
  float ph = uTime * 1.7 + wp.x * 0.37 + wp.z * 0.29;
  float s = sin(ph) + 0.45 * sin(ph * 2.31 + 1.7);
  float top = w > 0.75 ? clamp(tile.y, 0.0, 1.2) : 1.0;
  float amp = (w > 0.75 ? 0.075 : 0.028) * top;
  p.x += s * amp;
  p.z += cos(ph * 0.83 + 0.6) * amp * 0.8;
  return p;
}
`;

const TEX_GLSL = /* glsl */ `
vec4 lcwTexel(highp sampler2DArray atlas, vec3 tile) {
  vec2 tuv = tile.xy;
  vec2 f = clamp(fract(tuv), 0.001, 0.999);
  return textureGrad(atlas, vec3(f, tile.z), dFdx(tuv), dFdy(tuv));
}
/** world-space normal with the atlas normal map (the face's u, v axes are fixed per axis by the mesher) */
vec3 lcwBump(highp sampler2DArray mat, vec3 tile, vec3 n, out vec4 m) {
  m = lcwTexel(mat, tile);
  vec3 a = abs(n);
  vec3 t = a.x > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 b = a.y > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec2 d = m.xy * 2.0 - 1.0;
  return normalize(n + t * d.x + b * d.y);
}
/** ripples on water: two crossing wave trains (world xz), as a normal */
vec3 lcwWaterN(vec3 wp) {
  float t = uTime;
  vec2 g = vec2(cos(wp.x * 1.9 + t * 1.3) * 0.6 + cos((wp.x + wp.z) * 3.1 - t * 1.9) * 0.35,
                cos(wp.z * 2.3 - t * 1.1) * 0.6 + cos((wp.z - wp.x) * 2.7 + t * 1.6) * 0.35);
  return normalize(vec3(-g.x * 0.09, 1.0, -g.y * 0.09));
}
`;

const FAST_VERT = /* glsl */ `
attribute vec4 aTile;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
varying vec3 vTile;
varying float vGlow;
varying vec3 vVox;
varying vec3 vWorld;
varying vec3 vN;
#ifndef LCW_FINE
varying vec3 vLight;
#endif
${COMMON_GLSL}
${WIND_GLSL}
void main() {
  vec3 p = lcwWind(position, aTile, modelMatrix);
  vec3 n = normalize(normal);
  vec3 vox = color;
  vVox = vox;
  vN = n;
  vTile = aTile.xyz;
  vGlow = aTile.w;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  #ifndef LCW_FINE
  vec3 hemi = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 amb = hemi * lcwSkyB(vox.g) * vox.r;
  vec3 sun = uSunCol * max(dot(n, uSunDir), 0.0) * lcwSunVis(vox);
  vec3 lamp = uLampCol * lcwLampB(vox.b) * (0.55 + 0.45 * vox.r);
  vLight = (amb + sun) * (1.0 / 3.14159265) + lamp * 0.35;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

function fastFrag(translucent: boolean, fine: boolean): string {
  return /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
${fine ? 'uniform sampler2DArray uMat;' : ''}
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform vec3 uFogCol;
uniform vec3 uFogSunCol;
uniform float uFogNear;
uniform float uFogFar;
uniform float uHaze;
varying vec3 vTile;
varying float vGlow;
varying vec3 vVox;
varying vec3 vWorld;
varying vec3 vN;
#ifndef LCW_FINE
varying vec3 vLight;
#endif
${COMMON_GLSL}
${TEX_GLSL}
void main() {
  vec4 tex = lcwTexel(uAtlas, vTile);
  ${translucent ? 'if (tex.a < 0.02) discard;' : 'if (tex.a < 0.5) discard;'}
  vec3 V = normalize(cameraPosition - vWorld);
  float water = lcwIsWater(vTile);
  vec3 c;
  float alpha = ${translucent ? 'tex.a' : '1.0'};
  #ifdef LCW_FINE
  vec4 m;
  vec3 n = water > 0.5 ? lcwWaterN(vWorld) : (uWind[int(vTile.z + 0.5)] > 0.75 ? normalize(vN) : lcwBump(uMat, vTile, normalize(vN), m));
  float rough = water > 0.5 ? 0.04 : m.z;
  float metal = water > 0.5 ? 0.0 : m.w;
  if (uWind[int(vTile.z + 0.5)] > 0.75) { rough = 0.8; metal = 0.0; }
  vec3 hemi = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5);
  float skyB = lcwSkyB(vVox.g);
  float sunV = lcwSunVis(vVox);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 albedo = tex.rgb * (1.0 - metal * 0.6);
  vec3 lamp = uLampCol * lcwLampB(vVox.b) * (0.55 + 0.45 * vVox.r);
  vec3 diffuse = albedo * ((hemi * skyB * vVox.r + uSunCol * ndl * sunV) * (1.0 / 3.14159265) + lamp * 0.35);
  // sun specular (normalised Blinn-Phong from roughness) and the sky's reflection, both with Schlick fresnel
  vec3 H = normalize(uSunDir + V);
  float ndv = max(dot(n, V), 0.0);
  float shin = clamp(2.0 / max(rough * rough * rough * rough, 1e-4) - 2.0, 1.0, 4096.0);
  vec3 F0 = mix(vec3(0.04), tex.rgb, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  float spec = (shin + 8.0) / 25.13 * pow(max(dot(n, H), 0.0), shin) * ndl;
  vec3 R = reflect(-V, n);
  vec3 skyRefl = mix(uFogCol, uSkyCol * 0.9, clamp(R.y * 1.6, 0.0, 1.0)) * skyB;
  c = diffuse + uSunCol * spec * F * sunV * (1.0 - rough * 0.7) * 0.25 + skyRefl * F * (1.0 - rough) * (1.0 - rough) * 0.6;
  if (water > 0.5) alpha = mix(0.55, 0.96, F.x);
  #else
  c = tex.rgb * vLight;
  if (water > 0.5) {
    vec3 n = lcwWaterN(vWorld);
    float fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 H = normalize(uSunDir + V);
    c = mix(c, mix(uFogCol, uSkyCol, 0.5) * lcwSkyB(vVox.g), fr * 0.8) + uSunCol * pow(max(dot(n, H), 0.0), 220.0) * 0.6 * lcwSunVis(vVox);
    alpha = mix(0.55, 0.95, fr);
  }
  #endif
  c += tex.rgb * vGlow * 1.1;
  // fog: the loaded world's edge, a light haze, brighter toward the sun
  float d = length(vWorld - cameraPosition);
  float fog = max(smoothstep(uFogNear, uFogFar, d), 1.0 - exp(-d * uHaze));
  vec3 fc = mix(uFogCol, uFogSunCol, pow(max(dot(-V, uSunDir), 0.0), 6.0) * 0.55);
  c = mix(c, fc, fog);
  gl_FragColor = vec4(c, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
}

export interface SkyState {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  fog: THREE.Fog;
  /** fog colour toward the sun (sky.ts) */
  fogSun?: THREE.Color;
  /** exponential haze per metre (sky.ts) */
  haze?: number;
  /** seconds (wind, water) */
  time?: number;
  /** lamp brightness factor (lanterns read stronger at night) */
  lamp?: number;
}

export interface BlockMaterials {
  opaque: THREE.Material;
  translucent: THREE.Material;
  /** copy light/fog/time state from the sky each frame */
  sync(sky: SkyState): void;
  mode: BlockMaterialMode;
}

export interface BlockAtlases {
  albedo: THREE.DataArrayTexture;
  material: THREE.DataArrayTexture;
}

export function makeBlockMaterials(atlas: THREE.DataArrayTexture | BlockAtlases, mode: BlockMaterialMode): BlockMaterials {
  const albedo = 'albedo' in atlas ? atlas.albedo : atlas;
  const matTex = 'albedo' in atlas ? atlas.material : null;
  const shared = {
    uWind: { value: WIND_TABLE },
    uTime: { value: 0 },
    uWaterLayer: { value: WATER_LAYER },
    uLampCol: { value: LAMP_COLOR.clone() }
  };
  const syncShared = (sky: SkyState): void => {
    shared.uTime.value = sky.time ?? 0;
    shared.uLampCol.value.copy(LAMP_COLOR).multiplyScalar(sky.lamp ?? 1);
  };
  if (mode === 'lit') {
    const lit = (translucent: boolean): THREE.MeshStandardMaterial => {
      const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: translucent, depthWrite: !translucent });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, shared, { uAtlas: { value: albedo }, uMat: { value: matTex ?? albedo } });
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>\nattribute vec4 aTile;\nattribute vec3 color;\nvarying vec3 vTile;\nvarying float vGlow;\nvarying vec3 vVox;\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;\n${COMMON_GLSL}\n${WIND_GLSL}`
          )
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = lcwWind(transformed, aTile, modelMatrix);\nvTile = aTile.xyz;\nvGlow = aTile.w;\nvVox = color;\nvWorldN = normalize(mat3(modelMatrix) * normal);\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uAtlas;\nuniform sampler2DArray uMat;\nvarying vec3 vTile;\nvarying float vGlow;\nvarying vec3 vVox;\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;\n${COMMON_GLSL}\n${TEX_GLSL}`
          )
          .replace(
            '#include <map_fragment>',
            `vec4 texel = lcwTexel(uAtlas, vTile);\n${translucent ? 'if (texel.a < 0.02) discard;' : 'if (texel.a < 0.5) discard;'}\ndiffuseColor *= texel;\nfloat lcwWater = lcwIsWater(vTile);\nfloat lcwPlant = uWind[int(vTile.z + 0.5)] > 0.75 ? 1.0 : 0.0;\nvec4 lcwM = vec4(0.5, 0.5, 0.85, 0.0);\nvec3 lcwN = normalize(vWorldN);\nif (lcwWater > 0.5) lcwN = lcwWaterN(vWorldP);\nelse if (lcwPlant < 0.5) lcwN = lcwBump(uMat, vTile, lcwN, lcwM);`
          )
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = lcwWater > 0.5 ? 0.04 : (lcwPlant > 0.5 ? 0.8 : lcwM.z);')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = lcwWater > 0.5 || lcwPlant > 0.5 ? 0.0 : lcwM.w;')
          .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(lcwN, 0.0)).xyz);')
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
{
  float skyB = lcwSkyB(vVox.g);
  float sunV = mix(1.0, lcwSunVis(vVox), 0.6);
  reflectedLight.indirectDiffuse *= skyB * vVox.r;
  reflectedLight.directDiffuse *= sunV;
  reflectedLight.directSpecular *= sunV;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uLampCol * lcwLampB(vVox.b) * (0.55 + 0.45 * vVox.r) * 0.35;
  // the sky's reflection (no environment map): horizon to zenith along the reflected ray, fresnel-weighted
  vec3 lcwV = normalize(cameraPosition - vWorldP);
  vec3 lcwR = reflect(-lcwV, lcwN);
  float lcwF = pow(1.0 - max(dot(lcwN, lcwV), 0.0), 5.0);
  vec3 lcwF0 = mix(vec3(0.04), diffuseColor.rgb, metalnessFactor);
  vec3 lcwSky = mix(fogColor, hemisphereLights[0].skyColor, clamp(lcwR.y * 1.6, 0.0, 1.0));
  reflectedLight.indirectSpecular += lcwSky * (lcwF0 + (1.0 - lcwF0) * lcwF) * (1.0 - roughnessFactor) * (1.0 - roughnessFactor) * skyB * 0.6;
}`
          )
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 1.1;');
        if (translucent) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>\nif (lcwWater > 0.5) { float fr = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), 5.0); gl_FragColor.a = mix(0.55, 0.96, 0.02 + 0.98 * fr); }`
          );
        }
      };
      mat.customProgramCacheKey = () => (translucent ? 'lcw-block-pbr-t' : 'lcw-block-pbr-o');
      return mat;
    };
    return { opaque: lit(false), translucent: lit(true), sync: syncShared, mode };
  }
  const fine = mode === 'fine' && matTex !== null;
  const uniforms = {
    ...shared,
    uAtlas: { value: albedo },
    uMat: { value: matTex ?? albedo },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uSkyCol: { value: new THREE.Color(1, 1, 1) },
    uGroundCol: { value: new THREE.Color(0.5, 0.4, 0.3) },
    uFogCol: { value: new THREE.Color(1, 1, 1) },
    uFogSunCol: { value: new THREE.Color(1, 1, 1) },
    uFogNear: { value: 50 },
    uFogFar: { value: 100 },
    uHaze: { value: 0.004 }
  };
  const fast = (translucent: boolean): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms,
      defines: fine ? { LCW_FINE: 1 } : {},
      vertexShader: FAST_VERT,
      fragmentShader: fastFrag(translucent, fine),
      vertexColors: true,
      transparent: translucent,
      depthWrite: !translucent
    });
  return {
    opaque: fast(false),
    translucent: fast(true),
    mode: fine ? 'fine' : 'fast',
    sync(sky) {
      syncShared(sky);
      uniforms.uSunDir.value.copy(sky.sunDir);
      uniforms.uSunCol.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity);
      uniforms.uSkyCol.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity);
      uniforms.uGroundCol.value.copy(sky.hemi.groundColor).multiplyScalar(sky.hemi.intensity);
      uniforms.uFogCol.value.copy(sky.fog.color);
      uniforms.uFogSunCol.value.copy(sky.fogSun ?? sky.fog.color);
      uniforms.uFogNear.value = sky.fog.near;
      uniforms.uFogFar.value = sky.fog.far;
      uniforms.uHaze.value = sky.haze ?? 0.004;
    }
  };
}
