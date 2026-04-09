
const { GUI } = lil;
//const { vec3, vec4, mat4, quat } = glMatrix;

class CameraController {
  constructor() {
    this.target = [0, 1, 0]; this.orbit = { theta: 0.5, phi: 1.2, radius: 10 };
    this.position = vec3.create(); this.view = mat4.create(); this.proj = mat4.create();
    this.isPanning = false; this.isOrbiting = false;
    this.fov = 45;
    this.aperture = 0;
    this.focusDist = 1;
    this.exposure = 1;
  }
  update(aspect) {
    mat4.perspective(this.proj, this.fov * Math.PI / 180, aspect, 0.1, 1000);
    this.position[0] = this.target[0] + this.orbit.radius * Math.sin(this.orbit.phi) * Math.cos(this.orbit.theta);
    this.position[1] = this.target[1] + this.orbit.radius * Math.cos(this.orbit.phi);
    this.position[2] = this.target[2] + this.orbit.radius * Math.sin(this.orbit.phi) * Math.sin(this.orbit.theta);
    mat4.lookAt(this.view, this.position, this.target, [0, 1, 0]);
  }
  updateOrbit(position, target) {
    const dx = position[0] - target[0];
    const dy = position[1] - target[1];
    const dz = position[2] - target[2];
    const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (radius < 0.0001) return { phi: 0, theta: 0, radius: 0 };
    const phi = Math.acos(Math.max(-1, Math.min(1, dy / radius)));
    const theta = Math.atan2(dz, dx);
    this.orbit = { phi, theta, radius };
    this.position = position;
    this.target = target;
  }
}

const Cam = new CameraController();

function createCheckerboardDataURL(size = 256, squares = 8, color1 = '#ffffff', color2 = '#000000') {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const squareSize = size / squares;
  
  for (let y = 0; y < squares; y++) {
    for (let x = 0; x < squares; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? color1 : color2;
      ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize);
    }
  }
  
  return canvas.toDataURL();
}

const defaultMaterial = new Material("Default Material",[1,1,1],1);
defaultMaterial.name = "Default Material";
defaultMaterial.albedoTex = new Texture(createCheckerboardDataURL(64,2,"#ff00ff","#000"), "Checkerboard");
var renderCanvas = document.createElement('canvas');
const State = { tool: 't', scene: new Scene(renderCanvas), nodes: [], assets: [], selected: null, selectedAsset: null, idCounter: 1 };
State.scene.camera.target = Cam.target; State.scene.camera.position = Cam.position;
State.backgroundColor = [0.8,0.85,0.9];
State.backgroundIntensity = 1;
State.background = null;

// ==========================================
// NEW ARCHITECTURE: Node Hierarchy & Geometries
// ==========================================

// Dynamic Geometry Generators
const GeoGen = {
  cube() {
    const p = [-0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5, -0.5,-0.5,-0.5, -0.5,0.5,-0.5, 0.5,0.5,-0.5, 0.5,-0.5,-0.5, -0.5,0.5,-0.5, -0.5,0.5,0.5, 0.5,0.5,0.5, 0.5,0.5,-0.5, -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, 0.5,0.5,0.5, 0.5,-0.5,0.5, -0.5,-0.5,-0.5, -0.5,-0.5,0.5, -0.5,0.5,0.5, -0.5,0.5,-0.5];
    const n = [0,0,1,0,0,1,0,0,1,0,0,1, 0,0,-1,0,0,-1,0,0,-1,0,0,-1, 0,1,0,0,1,0,0,1,0,0,1,0, 0,-1,0,0,-1,0,0,-1,0,0,-1,0, 1,0,0,1,0,0,1,0,0,1,0,0, -1,0,0,-1,0,0,-1,0,0,-1,0,0];
    const i = [0,1,2,0,2,3, 4,5,6,4,6,7, 8,9,10,8,10,11, 12,13,14,12,14,15, 16,17,18,16,18,19, 20,21,22,20,22,23];
    return { p, n, i };
  },
  sphere(segs = 32) {
    const p = [], n = [], u = [], i = [];
    for (let y = 0; y <= segs; y++) {
      const v = y / segs, phi = v * Math.PI;
      for (let x = 0; x <= segs; x++) {
        const uVal = x / segs, theta = uVal * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);
        p.push(nx, ny, nz); // Local unit sphere, scale handles the rest
        n.push(nx, ny, nz);
        u.push(uVal, v);
      }
    }
    for (let y = 0; y < segs; y++) {
      for (let x = 0; x < segs; x++) {
        const a = y * (segs + 1) + x, b = a + 1, c = a + (segs + 1), d = c + 1;
        i.push(a, b, d, a, d, c);
      }
    }
    return { p, n, u, i };
  }
};

// Base Node Class
Primitive.prototype.updateGeo = function() {
  if (this.vaoData && gl) {
    gl.deleteVertexArray(this.vaoData.vao);
    gl.deleteBuffer(this.vaoData.pBuf); gl.deleteBuffer(this.vaoData.nBuf); gl.deleteBuffer(this.vaoData.iBuf);
  }
  const data = this.generateMesh();
  this.vaoData = window.createVAOWithBuffers(data.p, data.n, data.i, data.u);
}

class InteractionManager {
  constructor() {
    this.activeAxis = null; this.dragPlaneNorm = vec3.create();
    this.initialVal = null; this.initialHit = vec3.create(); this.lastAngle = 0;
  }
  getS() { return vec3.distance(Cam.position, State.selected.position) * 0.15; }
  
  testGizmo(ray) {
    if (!State.selected) return null;
    const s = this.getS(); const p = State.selected.position;
    let nearest = Infinity, hitId = null;

    if (State.tool === 't') {
      const planes = [{id:'xy', n:[0,0,1]}, {id:'yz', n:[1,0,0]}, {id:'xz', n:[0,1,0]}];
      planes.forEach(pl => {
        const t = MathUtils.rayPlane(ray, p, pl.n);
        if (t && t < nearest) {
          const h = vec3.scaleAndAdd(vec3.create(), ray.origin, ray.dir, t);
          const r = vec3.sub(vec3.create(), h, p);
          if (pl.id === 'xy' && r[0]>=0 && r[0]<s*0.4 && r[1]>=0 && r[1]<s*0.4) { nearest=t; hitId=pl.id; }
          if (pl.id === 'yz' && r[1]>=0 && r[1]<s*0.4 && r[2]>=0 && r[2]<s*0.4) { nearest=t; hitId=pl.id; }
          if (pl.id === 'xz' && r[0]>=0 && r[0]<s*0.4 && r[2]>=0 && r[2]<s*0.4) { nearest=t; hitId=pl.id; }
        }
      });
      ['x','y','z'].forEach((id, i) => {
        const min = vec3.add(vec3.create(), p, [-0.08*s, -0.08*s, -0.08*s]);
        const max = vec3.add(vec3.create(), p, [0.08*s, 0.08*s, 0.08*s]);
        max[i] += 1.3*s; const t = MathUtils.rayAABB(ray, min, max);
        if (t && t < nearest) { nearest = t; hitId = id; }
      });
    } else if (State.tool === 's') {
      const invQuat = quat.invert(quat.create(), State.selected.rotation);
      const lRayO = vec3.sub(vec3.create(), ray.origin, p);
      vec3.transformQuat(lRayO, lRayO, invQuat);
      const lRayD = vec3.transformQuat(vec3.create(), ray.dir, invQuat);
      const lRay = { origin: lRayO, dir: lRayD };
      const thick = 0.08 * s, len = 1.3 * s;
      const boxes = [
        {id:'all', min:[-0.25*s, -0.25*s, -0.25*s], max:[0.25*s, 0.25*s, 0.25*s]},
        {id:'x',min:[0,-thick,-thick],max:[len,thick,thick]}, {id:'nx',min:[-len,-thick,-thick],max:[0,thick,thick]},
        {id:'y',min:[-thick,0,-thick],max:[thick,len,thick]}, {id:'ny',min:[-thick,-len,-thick],max:[thick,0,thick]},
        {id:'z',min:[-thick,-thick,0],max:[thick,thick,len]}, {id:'nz',min:[-thick,-thick,-len],max:[thick,thick,0]}
      ];
      boxes.forEach(b => {
        const t = MathUtils.rayAABB(lRay, b.min, b.max);
        if (t !== null && t < nearest) { nearest = t; hitId = b.id; }
      });
    } else if (State.tool === 'r') {
      [{id:'x', n:[1,0,0]},{id:'y', n:[0,1,0]},{id:'z', n:[0,0,1]}].forEach(r => {
        const t = MathUtils.rayPlane(ray, p, r.n);
        if (t && t < nearest) {
          const d = vec3.dist(vec3.scaleAndAdd(vec3.create(), ray.origin, ray.dir, t), p);
          if (Math.abs(d - s) < s*0.15) { nearest = t; hitId = r.id; }
        }
      });
      const vd = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), Cam.position, p));
      const t = MathUtils.rayPlane(ray, p, vd);
      if (t && t < nearest) {
        const d = vec3.dist(vec3.scaleAndAdd(vec3.create(), ray.origin, ray.dir, t), p);
        if (Math.abs(d - s*1.3) < s*0.1) { nearest = t; hitId = 'cam'; }
      }
    }
    return hitId;
  }

  startDrag(id, ray) {
    this.activeAxis = id;
    if (State.tool === 't') {
      this.initialVal = vec3.copy(vec3.create(), State.selected.position);
      if (id === 'x' || id === 'xz') this.dragPlaneNorm = [0,1,0];
      else if (id === 'y' || id === 'xy') this.dragPlaneNorm = [0,0,1];
      else this.dragPlaneNorm = [1,0,0];
    } else if (State.tool === 's') {
      this.initialVal = vec3.copy(vec3.create(), State.selected.scale);
      if (id === 'all') {
        vec3.copy(this.dragPlaneNorm, Cam.view.slice(8, 11)); // Plane facing camera
      } else {
        const i = id.includes('x') ? 0 : (id.includes('y') ? 1 : 2);
        const lDir = [0,0,0]; lDir[i] = 1;
        const wDir = vec3.transformQuat(vec3.create(), lDir, State.selected.rotation);
        const camDir = vec3.sub(vec3.create(), Cam.position, State.selected.position);
        vec3.cross(this.dragPlaneNorm, wDir, vec3.cross(vec3.create(), camDir, wDir));
        vec3.normalize(this.dragPlaneNorm, this.dragPlaneNorm);
      }
    } else if (State.tool === 'r') {
      this.initialVal = quat.copy(quat.create(), State.selected.rotation);
      if (id === 'cam') vec3.normalize(this.dragPlaneNorm, vec3.sub(vec3.create(), Cam.position, State.selected.position));
      else this.dragPlaneNorm = id === 'x' ? [1,0,0] : (id === 'y' ? [0,1,0] : [0,0,1]);
    }
    const t = MathUtils.rayPlane(ray, State.selected.position, this.dragPlaneNorm);
    if (t) {
      this.initialHit = vec3.scaleAndAdd(vec3.create(), ray.origin, ray.dir, t);
      this.lastAngle = this.getAngle(this.initialHit);
    }
  }

  getAngle(hit) {
    const rel = vec3.sub(vec3.create(), hit, State.selected.position);
    const up = this.activeAxis === 'y' ? [0,0,1] : [0,1,0];
    if (this.activeAxis === 'cam') {
      const u = vec3.fromValues(Cam.view[1], Cam.view[5], Cam.view[9]);
      const r = vec3.fromValues(Cam.view[0], Cam.view[4], Cam.view[8]);
      return Math.atan2(vec3.dot(rel, u), vec3.dot(rel, r));
    }
    const right = vec3.cross(vec3.create(), this.dragPlaneNorm, up);
    return -Math.atan2(vec3.dot(rel, up), vec3.dot(rel, right));
  }

  updateDrag(ray) {
    const t = MathUtils.rayPlane(ray, State.selected.position, this.dragPlaneNorm);
    if (!t) return;
    const hit = vec3.scaleAndAdd(vec3.create(), ray.origin, ray.dir, t);
    const move = vec3.sub(vec3.create(), hit, this.initialHit);
    
    if (State.tool === 't') {
      if (this.activeAxis.length === 1) {
        const i = this.activeAxis === 'x' ? 0 : (this.activeAxis === 'y' ? 1 : 2);
        State.selected.position[i] = this.initialVal[i] + move[i];
      } else {
        if (this.activeAxis === 'xy') { State.selected.position[0]+=move[0]; State.selected.position[1]+=move[1]; }
        if (this.activeAxis === 'yz') { State.selected.position[1]+=move[1]; State.selected.position[2]+=move[2]; }
        if (this.activeAxis === 'xz') { State.selected.position[0]+=move[0]; State.selected.position[2]+=move[2]; }
        vec3.copy(this.initialHit, hit);
      }
    } else if (State.tool === 's') {
      if (this.activeAxis === 'all') {
        const initialDist = vec3.distance(this.initialHit, State.selected.position);
        const currentDist = vec3.distance(hit, State.selected.position);
        const factor = Math.max(0.01, currentDist / initialDist); // Scale multiplier
        vec3.scale(State.selected.scale, this.initialVal, factor);
      } else {
        const i = this.activeAxis.includes('x') ? 0 : (this.activeAxis.includes('y') ? 1 : 2);
        const sign = this.activeAxis.startsWith('n') ? -1 : 1;
        const lAxis = [0,0,0]; lAxis[i] = 1;
        const wAxis = vec3.transformQuat(vec3.create(), lAxis, State.selected.rotation);
        const hitDist = vec3.dot(vec3.sub(vec3.create(), hit, State.selected.position), wAxis);
        const iniDist = vec3.dot(vec3.sub(vec3.create(), this.initialHit, State.selected.position), wAxis);
        const delta = (hitDist - iniDist) * sign;
        State.selected.scale[i] = Math.max(0.01, this.initialVal[i] + delta);
      }
    } else if (State.tool === 'r') {
      const cur = this.getAngle(hit);
      const delta = cur - this.lastAngle;
      const inc = quat.setAxisAngle(quat.create(), this.dragPlaneNorm, delta);
      quat.mul(State.selected.rotation, inc, State.selected.rotation);
      this.lastAngle = cur;
    }
  }
}

const Interact = new InteractionManager();
const gl_canvas = document.getElementById('glcanvas');
window.gl = gl_canvas.getContext('webgl2', { antialias: true });

// Prevent context menu to allow smooth RMB panning
gl_canvas.addEventListener('contextmenu', e => e.preventDefault());

const vs = `#version 300 es
  layout(location=0) in vec3 a_pos; 
  layout(location=1) in vec3 a_norm;
  layout(location=2) in vec2 a_uv;

  uniform mat4 u_mvp; 
  uniform mat4 u_model; 
  
  out vec3 v_norm;
  out vec3 v_worldPos;
  out vec2 v_uv;
  out vec3 v_viewDir;

  uniform vec3 u_camPos;

  void main() { 
    vec4 worldPos = u_model * vec4(a_pos, 1.0);
    v_worldPos = worldPos.xyz;
    v_viewDir = normalize(u_camPos - worldPos.xyz);
    v_norm = normalize(mat3(u_model) * a_norm); 
    v_uv = a_uv;
    gl_Position = u_mvp * vec4(a_pos, 1.0); 
  }`;

const fs = `#version 300 es
  precision highp float;

  in vec3 v_norm; 
  in vec3 v_worldPos;
  in vec2 v_uv;
  in vec3 v_viewDir;

  uniform vec4 u_color; 
  uniform float u_metallic;
  uniform float u_roughness;
  uniform float u_ior;
  
  uniform float u_specularTint;
  uniform float u_anisotropic;
  uniform float u_anisotropicRotation;
  uniform float u_sheen;
  uniform float u_sheenTint;
  uniform float u_clearcoat;
  uniform float u_clearcoatGloss;
  uniform float u_clearcoatIor;
  uniform float u_transmission;
  uniform float u_concentration;
  
  uniform float u_subsurface;
  uniform vec3 u_subsurfaceTint;
  uniform vec3 u_emittance; 

  uniform sampler2D u_albedoTex;
  uniform sampler2D u_normalTex;
  uniform sampler2D u_roughnessTex;
  uniform sampler2D u_metallicTex;
  uniform sampler2D u_emissiveTex;
  
  uniform bool u_hasAlbedo;
  uniform bool u_hasNormal;
  uniform bool u_hasRoughness;
  uniform bool u_hasMetallic;
  uniform bool u_hasEmissive;

  uniform vec2 u_uvScale; 
  uniform float u_normalMultiplier;
  uniform int u_mode;

  out vec4 outColor;

  // Fresnel with Roughness compensation
  vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }

  vec3 sampleSky(vec3 dir, float roughness) {
    float t = 0.5 * (dir.y + 1.0);
    vec3 skyColor = mix(vec3(0.05), vec3(0.5, 0.7, 1.0), t);
    float sun = pow(max(0.0, dot(dir, normalize(vec3(1, 1, 1)))), mix(128.0, 2.0, roughness));
    return skyColor + sun * 4.0;
  }

  vec3 getNormal(vec2 uv) {
    vec3 tangentNormal = texture(u_normalTex, uv).xyz * 2.0 - 1.0;
    tangentNormal = normalize(tangentNormal * vec3(u_normalMultiplier, u_normalMultiplier, 1.0));
    vec3 q1 = dFdx(v_worldPos);
    vec3 q2 = dFdy(v_worldPos);
    vec2 st1 = dFdx(uv);
    vec2 st2 = dFdy(uv);
    vec3 N = normalize(v_norm);
    vec3 T = normalize(q1 * st2.t - q2 * st1.t);
    vec3 B = -normalize(cross(N, T));
    return normalize(mat3(T, B, N) * tangentNormal);
  }

  void main() {
    if (u_mode == 1) { outColor = u_color; return; }

    vec2 uv = v_uv * u_uvScale;
    vec3 N = u_hasNormal ? getNormal(uv) : normalize(v_norm);
    vec3 SN = normalize(v_norm);
    vec3 V = normalize(v_viewDir);
    float dotNV = min(abs(dot(N, V)), 1.0);
    float dotSNV = min(abs(dot(SN, V)), 1.0);
    
    // TBN for Anisotropy
    vec3 up = abs(N.y) < 0.99999 ? vec3(0,1,0) : vec3(0,0,1);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
    // Rotate Tangents
    float angle = u_anisotropicRotation * 6.28318;
    T = T * cos(angle) + B * sin(angle);
    B = cross(N, T);

    vec3 albedo = pow(u_color.rgb, vec3(2.2));
    if (u_hasAlbedo) albedo *= pow(texture(u_albedoTex, uv).rgb, vec3(2.2));
    float roughness = u_roughness;
    if (u_hasRoughness) roughness *= texture(u_roughnessTex, uv).g;
    float metallic = u_metallic;
    if (u_hasMetallic) metallic *= texture(u_metallicTex, uv).b;

    // F0 calculation
    float f0_dielectric = pow((1.0 - u_ior) / (1.0 + u_ior), 2.0);
    vec3 f0 = mix(vec3(f0_dielectric), albedo, metallic);
    f0 = mix(f0, f0 * albedo, u_specularTint);
    
    // 1. ANISOTROPIC REFLECTION
    // We stretch the reflection vector based on anisotropy
    vec3 aniso_dir = mix(N, cross(cross(V, T), T), u_anisotropic);
    vec3 R = reflect(-V, normalize(mix(N, aniso_dir, u_anisotropic)));
    
    // Fresnel with Roughness Bias (Fixes the "bright edge" on rough objects)
    vec3 F = fresnelSchlickRoughness(dotNV, f0, roughness);

    vec3 finalColor = vec3(0.0);
    float alpha = u_color.a;

    // Transmission (Your Beer's Law Logic)
    float thickness = max(0.0, dotNV) * 2.0;
    vec3 sigma = -log(max(u_color.rgb, vec3(0.01))) * u_concentration;
    vec3 transmissionFactor = exp(-sigma * thickness);
    vec3 refractDir = refract(-V, N, 1.0 / u_ior);
    vec3 transLight = sampleSky(refractDir, roughness) * transmissionFactor;
    vec3 reflLight = sampleSky(R, roughness);
    vec3 transmissionColor = mix(transLight, reflLight, F) * 2.;
    float avgTrans = (transmissionFactor.r + transmissionFactor.g + transmissionFactor.b) / 3.0;
    alpha = mix(1.0 - avgTrans, 1.0, F.r); 
  
    // Opaque / Metal
    vec3 specEnv = sampleSky(R, roughness) * F;
    vec3 diffEnv = albedo * sampleSky(N, 1.0) * (1.0 - F) * (1.0 - metallic);
    
    // SUBSURFACE (Wrapped light with Scatter Tint)
    if (u_subsurface > 0.0 && metallic < 0.1) {
      vec3 L = normalize(vec3(1,1,1));
      float w = 0.5; // wrap
      float sss_diff = max(0.0, (dot(N, L) + w) / ((1.0+w)*(1.0+w)));
      vec3 sss_color = pow(u_subsurfaceTint, vec3(2.2)) * sss_diff;
      diffEnv = mix(diffEnv, sss_color, u_subsurface);
    }

    vec3 opaqueColor = diffEnv + specEnv;
    alpha = mix(alpha, 1.0, metallic);

    // SHEEN (Velvet / Cloth grazing)
    if (u_sheen > 0.0) {
      float sheenFres = pow(1.0 - dotNV, 3.0);
      vec3 sheenColor = mix(vec3(1.0), albedo, u_sheenTint);
      opaqueColor += sheenColor * sheenFres * u_sheen;
    }

    finalColor = mix(opaqueColor,transmissionColor,u_transmission);
    alpha = mix(1.0,alpha,u_transmission);

    // 2. CLEAR COAT (Applied on Top)
    if (u_clearcoat > 0.0) {
      float ccF0 = pow((1.0 - u_clearcoatIor) / (1.0 + u_clearcoatIor), 2.0);
      float Fcc = ccF0 + (1.0 - ccF0) * pow(1.0 - dotSNV, 5.0);
      vec3 ccR = reflect(-V, SN);
      vec3 ccEnv = sampleSky(ccR, 1.0 - u_clearcoatGloss) * 2.5;
      finalColor = finalColor * (1.0 - Fcc * u_clearcoat) + (ccEnv * Fcc * u_clearcoat);
    }

    // 3. EMISSION
    vec3 emissive = u_emittance;
    if (u_hasEmissive) emissive *= pow(texture(u_emissiveTex, uv).rgb, vec3(2.2));
    finalColor += emissive;

    finalColor = finalColor / (finalColor + vec3(1.0)); // Tone Mapping
    outColor = vec4(pow(finalColor, vec3(1.0/2.2)), alpha);
  }
`;

function createShaderProgram(gl, vsSource, fsSource) {
  const compileShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeName = type === gl.VERTEX_SHADER ? "VERTEX" : "FRAGMENT";
      console.error(`GLSL ${typeName} SHADER ERROR:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compileShader(gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
  
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("GLSL PROGRAM LINK ERROR:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
const prog = createShaderProgram(gl,vs,fs);
const locs = {
  mvp: gl.getUniformLocation(prog, "u_mvp"),
  model: gl.getUniformLocation(prog, "u_model"),
  mode: gl.getUniformLocation(prog, "u_mode"),
  camPos: gl.getUniformLocation(prog, "u_camPos"),
  
  color: gl.getUniformLocation(prog, "u_color"),
  metallic: gl.getUniformLocation(prog, "u_metallic"),
  roughness: gl.getUniformLocation(prog, "u_roughness"),
  ior: gl.getUniformLocation(prog, "u_ior"),
  
  specularTint: gl.getUniformLocation(prog, "u_specularTint"),
  anisotropic: gl.getUniformLocation(prog, "u_anisotropic"),
  anisotropicRotation: gl.getUniformLocation(prog, "u_anisotropicRotation"),
  sheen: gl.getUniformLocation(prog, "u_sheen"),
  sheenTint: gl.getUniformLocation(prog, "u_sheenTint"),
  clearcoat: gl.getUniformLocation(prog, "u_clearcoat"),
  clearcoatGloss: gl.getUniformLocation(prog, "u_clearcoatGloss"),
  clearcoatIor: gl.getUniformLocation(prog, "u_clearcoatIor"),
  transmission: gl.getUniformLocation(prog, "u_transmission"),
  concentration: gl.getUniformLocation(prog, "u_concentration"),
  
  subsurface: gl.getUniformLocation(prog, "u_subsurface"),
  subsurfaceTint: gl.getUniformLocation(prog, "u_subsurfaceTint"),
  emittance: gl.getUniformLocation(prog, "u_emittance"),

  albedoTex: gl.getUniformLocation(prog, "u_albedoTex"),
  normalTex: gl.getUniformLocation(prog, "u_normalTex"),
  roughnessTex: gl.getUniformLocation(prog, "u_roughnessTex"),
  metallicTex: gl.getUniformLocation(prog, "u_metallicTex"),
  emissiveTex: gl.getUniformLocation(prog, "u_emissiveTex"),

  hasAlbedo: gl.getUniformLocation(prog, "u_hasAlbedo"),
  hasNormal: gl.getUniformLocation(prog, "u_hasNormal"),
  hasRoughness: gl.getUniformLocation(prog, "u_hasRoughness"),
  hasMetallic: gl.getUniformLocation(prog, "u_hasMetallic"),
  hasEmissive: gl.getUniformLocation(prog, "u_hasEmissive"),
  
  uvScale: gl.getUniformLocation(prog, "u_uvScale"),
  normalMultiplier: gl.getUniformLocation(prog, "u_normalMultiplier")
};
function setMaterialUniforms(mat) {
  if (!mat) return;

  const bindTex = (loc, hasLoc, tex, unit) => {
    let active = false;
    if (tex) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (!tex.glTexture) window.uploadTextureToGPU(tex);
      gl.bindTexture(gl.TEXTURE_2D, tex.glTexture);
      gl.uniform1i(loc, unit);
      active = true;
    }
    gl.uniform1i(hasLoc, active ? 1 : 0);
  };

  bindTex(locs.albedoTex, locs.hasAlbedo, mat.albedoTex, 0);
  bindTex(locs.normalTex, locs.hasNormal, mat.normalTex, 1);
  bindTex(locs.roughnessTex, locs.hasRoughness, mat.roughnessTex, 2);
  bindTex(locs.metallicTex, locs.hasMetallic, mat.metallicTex, 3);
  bindTex(locs.emissiveTex, locs.hasEmissive, mat.emissiveTex, 4);

  gl.uniform4fv(locs.color, [...mat.color, 1.0]);
  gl.uniform1f(locs.metallic, mat.metallic || 0);
  gl.uniform1f(locs.roughness, mat.roughness || 0);
  gl.uniform1f(locs.ior, mat.ior || 1.5);
  
  gl.uniform1f(locs.specularTint, mat.specularTint || 0);
  gl.uniform1f(locs.anisotropic, mat.anisotropic || 0);
  gl.uniform1f(locs.anisotropicRotation, mat.anisotropicRotation || 0);
  gl.uniform1f(locs.sheen, mat.sheen || 0);
  gl.uniform1f(locs.sheenTint, mat.sheenTint || 0);
  
  gl.uniform1f(locs.clearcoat, mat.clearcoat || 0);
  gl.uniform1f(locs.clearcoatGloss, mat.clearcoatGloss !== undefined ? mat.clearcoatGloss : 1);
  gl.uniform1f(locs.clearcoatIor, mat.clearcoatIor || 1.5);
  gl.uniform1f(locs.transmission, mat.transmission || 0);
  gl.uniform1f(locs.concentration, mat.concentration !== undefined ? mat.concentration : 1);
  
  gl.uniform1f(locs.subsurface, mat.subsurface || 0);
  gl.uniform3fv(locs.subsurfaceTint, mat.subsurfaceTint || mat.color);
  gl.uniform3fv(locs.emittance, (mat.emittance || [0,0,0]).map(v => v * (mat.emissionIntensity || 0)));

  gl.uniform2fv(locs.uvScale, mat.uvScale || [1, 1]);
  gl.uniform1f(locs.normalMultiplier, mat.normalMultiplier || 1);
}
// Modified slightly to return buffers so we can delete them later
window.createVAOWithBuffers = (p, n, i, u) => {
  const vao = gl.createVertexArray(); 
  gl.bindVertexArray(vao);
  
  const b = (d, l) => { 
    const x = gl.createBuffer(); 
    gl.bindBuffer(l, x); 
    gl.bufferData(l, d, gl.STATIC_DRAW); 
    return x; 
  };

  const pBuf = b(new Float32Array(p), gl.ARRAY_BUFFER); 
  gl.enableVertexAttribArray(0); 
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const nBuf = b(new Float32Array(n), gl.ARRAY_BUFFER); 
  gl.enableVertexAttribArray(1); 
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  // Add UV buffer at location 2
  // If u is missing, we create a dummy buffer of zeros
  const uvData = u ? new Float32Array(u) : new Float32Array((p.length / 3) * 2);
  const uBuf = b(uvData, gl.ARRAY_BUFFER); 
  gl.enableVertexAttribArray(2); 
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  const iBuf = b(new Uint32Array(i), gl.ELEMENT_ARRAY_BUFFER); 
  
  return { vao, count: i.length, pBuf, nBuf, uBuf, iBuf };
};
window.uploadTextureToGPU = (textureInstance) => {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  
  // Set parameters for a nice sampler
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureInstance.image);
  gl.generateMipmap(gl.TEXTURE_2D);
  
  textureInstance.glTexture = tex;
  return tex;
};

// Default Gizmo Geometries
const cubeData = GeoGen.cube();
const cubeGeo = window.createVAOWithBuffers(cubeData.p, cubeData.n, cubeData.i);
const lineCubeGeo = (() => {
  const p = [
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5
  ];
  const i = [
    0,1, 1,2, 2,3, 3,0, // Back
    4,5, 5,6, 6,7, 7,4, // Front
    0,4, 1,5, 2,6, 3,7  // Connectors
  ];
  return window.createVAOWithBuffers(p, p, i); // Normals don't matter for lines
})();
const circleGeo = (() => {
  const p=[], n=[], i=[], segs=100;
  for(let s=0; s<=segs; s++){ const r=(s/segs)*Math.PI*2; p.push(Math.cos(r), 0, Math.sin(r)); n.push(0,1,0); if(s<segs) i.push(s, s+1); }
  return window.createVAOWithBuffers(p, n, i);
})();
const gridGeo = (() => {
  const p=[], n=[], i=[], size=20;
  for(let g=-size; g<=size; g++){ p.push(-size,0,g, size,0,g, g,0,-size, g,0,size); n.push(0,1,0, 0,1,0, 0,1,0, 0,1,0); i.push(i.length, i.length+1, i.length+2, i.length+3); }
  return window.createVAOWithBuffers(p, n, i);
})();

function drawScene(objects,vp) {
  var drawObject = (n)=>{
    n.updateMatrix(); const mvp = mat4.mul(mat4.create(), vp, n.matrix);
    gl.uniformMatrix4fv(locs.mvp, false, mvp); gl.uniformMatrix4fv(locs.model, false, n.matrix);
    
    // Draw Dynamic Node Geometry
    if (!n.vaoData) n.updateGeo(); 
    gl.bindVertexArray(n.vaoData.vao);
    gl.uniform1i(locs.mode, 0);

    setMaterialUniforms(n.material);

    gl.uniform3fv(locs.camPos, Cam.position);

    gl.drawElements(gl.TRIANGLES, n.vaoData.count, gl.UNSIGNED_INT, 0);
  };

  const opaques = [];
  const transparents = [];

  // 1. Bucket objects by material type
  objects.forEach(obj => {
    // material_type 2 is Dielectric (Glass)
    const isTransparent = obj.material.transmission !== 0;
    if (isTransparent) {
      // Calculate distance for sorting
      // We use squared distance to avoid expensive Math.sqrt calls
      const dx = obj.position[0] - Cam.position[0];
      const dy = obj.position[1] - Cam.position[1];
      const dz = obj.position[2] - Cam.position[2];
      obj._distSq = dx * dx + dy * dy + dz * dz;
      transparents.push(obj);
    } else {
      opaques.push(obj);
    }
  });

  // 2. Prepare GL State
  //gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  // --- PASS 1: OPAQUE ---
  // Draw opaque objects with depth writing enabled
  gl.disable(gl.BLEND);
  gl.depthMask(true); 
  
  opaques.forEach(obj => {
    drawObject(obj); 
  });

  // --- PASS 2: TRANSPARENT ---
  // Sort Back-to-Front (highest distance first)
  transparents.sort((a, b) => b._distSq - a._distSq);

  // Enable blending for transparency
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  
  // CRITICAL: Disable depth writing so transparent objects don't 
  // occlude things behind them, but they still respect the Opaque depth buffer.
  gl.depthMask(false);

  transparents.forEach(obj => {
    drawObject(obj);
  });
}

function draw() {
  const w = gl_canvas.parentElement.clientWidth, h = gl_canvas.parentElement.clientHeight;
  if(gl_canvas.width!==w || gl_canvas.height!==h) { gl_canvas.width=w; gl_canvas.height=h; }
  gl.viewport(0,0,w,h); gl.clearColor(0.09, 0.09, 0.09, 1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.useProgram(prog);
  const vp = mat4.mul(mat4.create(), Cam.proj, Cam.view);

  // Draw Grid
  gl.uniformMatrix4fv(locs.mvp, false, vp); gl.uniformMatrix4fv(locs.model, false, mat4.create());
  gl.uniform1i(locs.mode, 1); gl.uniform4f(locs.color, 0.2, 0.2, 0.2, 1);
  gl.bindVertexArray(gridGeo.vao); gl.drawElements(gl.LINES, gridGeo.count, gl.UNSIGNED_INT, 0);

  drawScene(State.nodes,vp);

  gl.depthMask(true); 

  if (State.selected) {
    const n = State.selected;
    gl.clear(gl.DEPTH_BUFFER_BIT); const s = Interact.getS();
    const gPos = mat4.fromTranslation(mat4.create(), State.selected.position);
    const gRot = mat4.fromQuat(mat4.create(), State.selected.rotation);

    var bounds = n.getBounds();
    var selmat = mat4.create();
    mat4.translate(selmat, selmat, [0,1,2].map(i=>(bounds.max[i]+bounds.min[i])/2+0.001));
    mat4.scale(selmat, selmat, [0,1,2].map(i=>bounds.max[i]-bounds.min[i]));
    n.updateMatrix(); const mvp = mat4.mul(mat4.create(), vp, selmat);
    gl.uniformMatrix4fv(locs.mvp, false, mvp); gl.uniformMatrix4fv(locs.model, false, selmat);
    gl.uniform1i(locs.mode, 1); gl.uniform4f(locs.color, 1, 1, 1, 1);
    
    // For models and complex objects, highlighting the AABB bounds is usually best
    gl.bindVertexArray(lineCubeGeo.vao); 
    gl.drawElements(gl.LINES, lineCubeGeo.count, gl.UNSIGNED_INT, 0);

    if (State.tool === 't') {
      [{id:'x',c:[1,0,0,1],r:[0,0,-Math.PI/2]},{id:'y',c:[0,1,0,1],r:[0,0,0]},{id:'z',c:[0,0,1,1],r:[Math.PI/2,0,0]}].forEach(a => {
        let m = mat4.clone(gPos); mat4.rotateX(m,m,a.r[0]); mat4.rotateZ(m,m,a.r[2]);
        let stem = mat4.scale(mat4.clone(m), mat4.translate(mat4.clone(m), m, [0, 0.5*s, 0]), [0.03*s, 1*s, 0.03*s]);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, stem));
        gl.uniform4fv(locs.color, Interact.activeAxis===a.id?[1,1,0,1]:a.c); gl.uniform1i(locs.mode, 1);
        gl.bindVertexArray(cubeGeo.vao); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_INT, 0);
      });
      [{id:'xy',c:[1,1,0,0.3],r:[-Math.PI/2,0,0]},{id:'yz',c:[0,1,1,0.3],r:[0,0,Math.PI/2]},{id:'xz',c:[1,0,1,0.3],r:[0,0,0]}].forEach(p => {
        let m = mat4.clone(gPos); mat4.rotateX(m,m,p.r[0]); mat4.rotateZ(m,m,p.r[2]);
        mat4.translate(m,m,[0.2*s,0,0.2*s]); mat4.scale(m,m,[0.4*s,0.01,0.4*s]);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, m)); gl.uniform4fv(locs.color, Interact.activeAxis===p.id?[1,1,0,0.7]:p.c);
        gl.uniform1i(locs.mode, 1);
        gl.bindVertexArray(cubeGeo.vao); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_INT, 0);
        gl.disable(gl.BLEND);
      });
    } else if (State.tool === 's') {
      [{id:'x',c:[1,0,0,1],v:[1,0,0]},{id:'nx',c:[1,0,0,1],v:[-1,0,0]},{id:'y',c:[0,1,0,1],v:[0,1,0]},{id:'ny',c:[0,1,0,1],v:[0,-1,0]},{id:'z',c:[0,0,1,1],v:[0,0,1]},{id:'nz',c:[0,0,1,1],v:[0,0,-1]}].forEach(a => {
        let m = mat4.clone(gPos); mat4.mul(m, m, gRot);
        if(a.v[0]!==0) mat4.rotateZ(m, m, -a.v[0]*Math.PI/2);
        if(a.v[2]!==0) mat4.rotateX(m, m, a.v[2]*Math.PI/2);
        if(a.v[1]<0) mat4.rotateX(m, m, Math.PI);
        let stem = mat4.scale(mat4.clone(m), mat4.translate(mat4.clone(m), m, [0, 0.5*s, 0]), [0.03*s, 1*s, 0.03*s]);
        gl.uniform1i(locs.mode, 1);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, stem)); gl.uniform4fv(locs.color, Interact.activeAxis===a.id?[1,1,0,1]:a.c);
        gl.bindVertexArray(cubeGeo.vao); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_INT, 0);
        let head = mat4.scale(mat4.clone(m), mat4.translate(mat4.clone(m), m, [0, 1.1*s, 0]), [0.15*s, 0.15*s, 0.15*s]);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, head)); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_INT, 0);
      });
      let mCenter = mat4.clone(gPos); mat4.mul(mCenter, mCenter, gRot);
      let centerCube = mat4.scale(mat4.create(), mCenter, [0.25 * s, 0.25 * s, 0.25 * s]);
      gl.uniform1i(locs.mode, 1);
      gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, centerCube));
      gl.uniform4fv(locs.color, Interact.activeAxis === 'all' ? [1, 1, 0, 1] : [1, 1, 1, 1]);
      gl.bindVertexArray(cubeGeo.vao);
      gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_INT, 0);
    } else if (State.tool === 'r') {
      [{id:'x',c:[1,0,0,1],r:[0,0,Math.PI/2]},{id:'y',c:[0,1,0,1],r:[0,0,0]},{id:'z',c:[0,0,1,1],r:[Math.PI/2,0,0]}].forEach(r => {
        let m = mat4.clone(gPos); mat4.rotateX(m,m,r.r[0]); mat4.rotateZ(m,m,r.r[2]); mat4.scale(m,m,[s,s,s]);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, m)); gl.uniform4fv(locs.color, Interact.activeAxis===r.id?[1,1,0,1]:r.c);
        gl.uniform1i(locs.mode, 1);
        gl.bindVertexArray(circleGeo.vao); gl.drawElements(gl.LINES, circleGeo.count, gl.UNSIGNED_INT, 0);
      });
      let outer = mat4.targetTo(mat4.create(), State.selected.position, Cam.position, [0,1,0]);
      mat4.rotateX(outer, outer, Math.PI/2); mat4.scale(outer, outer, [s*1.3, s*1.3, s*1.3]);
      gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, outer)); gl.uniform4fv(locs.color, Interact.activeAxis==='cam'?[1,1,0,1]:[1,1,1,0.5]);
      gl.uniform1i(locs.mode, 1);
      gl.drawElements(gl.LINES, circleGeo.count, gl.UNSIGNED_INT, 0);
    }
  }
}

const selectNode = id => { State.selected = State.nodes.find(n => n.id === id) || null; State.selectedAsset=null; renderList(); renderInspector(); };
const selectAsset = asset => { State.selectedAsset = asset; State.selected=null; renderAssets(); renderInspector(); };

const renderList = () => {
  const root = document.getElementById('node-list'); root.innerHTML = '';
  State.nodes.forEach(n => {
    const el = document.createElement('div'); 
    el.className = `node-item ${State.selected?.id === n.id ? 'selected' : ''}`;
    el.innerHTML = `<span>${n.icon}</span> ${n.name}`; 
    el.onclick = () => selectNode(n.id);
    el.draggable = true;
    el.ondragstart = (e) => e.dataTransfer.setData("text/plain", n.id);
    el.oncontextmenu = e => { 
      e.preventDefault(); 
      selectNode(n.id); 
      ctxMenu.style.display='block'; 
      ctxMenu.style.left=e.clientX+'px'; 
      ctxMenu.style.top=e.clientY+'px'; 
    };
    el.ondragover = e => e.preventDefault();
    el.ondrop = e => {
      const assetId = e.dataTransfer.getData('assetId');
      const asset = State.assets.find(a => a.id === assetId);
      if (asset && asset instanceof Material) { n.material = asset; renderInspector(); }
    };
    root.appendChild(el);
  });
};


const sphereData = GeoGen.sphere();
const sphereGeo = window.createVAOWithBuffers(sphereData.p, sphereData.n, sphereData.i, sphereData.u);
/**
 * Generates a DataURL for a material preview using the GLOBAL gl context.
 * Renders to a temporary FBO to avoid flickering the main canvas.
 */
function generatePreview(callback,size) {
  const gl = window.gl; 
  if (!gl) {
    console.error("Global WebGL context 'gl' not found.");
    return "";
  }

  // 1. Create temporary resources on the global context
  const targetTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, targetTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  
  const depthBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTexture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);

  // 3. Render State
  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0); // Dark grey background for preview
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  callback();

  // 4. Synchronous Readback
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // 5. Cleanup FBO and restore main canvas binding
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(targetTexture);
  gl.deleteRenderbuffer(depthBuffer);

  // 6. Convert pixels to DataURL (with Y-flip)
  const canvas2d = document.createElement('canvas');
  canvas2d.width = size;
  canvas2d.height = size;
  const ctx2d = canvas2d.getContext('2d');
  const imgData = ctx2d.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    imgData.data.set(pixels.subarray(srcRow, srcRow + size * 4), dstRow);
  }
  ctx2d.putImageData(imgData, 0, 0);

  return canvas2d.toDataURL("image/png");
}
function generateMaterialPreview(material, size = 256) {
  gl.enable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const url = generatePreview(function(){
    // 2. Setup Scene Matrices
    const projection = mat4.perspective(mat4.create(), 0.6, 1, 0.1, 10);
    const view = mat4.lookAt(mat4.create(), [0, 0, 4], [0, 0, 0], [0, 1, 0]);
    const mvp = mat4.multiply(mat4.create(), projection, view);
    const model = mat4.create();

    // Use the global program and sphere geometry
    if (prog && sphereGeo) {
      gl.useProgram(prog);
      gl.bindVertexArray(sphereGeo.vao);

      // Set Uniforms using the global 'locs' object
      gl.uniformMatrix4fv(locs.mvp, false, mvp);
      gl.uniformMatrix4fv(locs.model, false, model);
      gl.uniform1i(locs.mode, 0);
      
      setMaterialUniforms(material);

      gl.uniform3fv(locs.camPos, [0, 0, 4]);

      gl.drawElements(gl.TRIANGLES, sphereGeo.count, gl.UNSIGNED_INT, 0);
    }
  },size);
  material.urlData = url;
  return url;
}
var previewMaterial = new Material("Preview Material",[0.6,0.6,0.6],0.5);
function generateModelPreview(modeldata, size = 256) {
  const modelObj = new Model("",previewMaterial,modeldata);
  if (!modelObj.veoData) modelObj.updateGeo();

  const url = generatePreview(function(){
    const bounds = modelObj.getBounds() || { min: [-1, -1, -1], max: [1, 1, 1] };
    const center = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2
    ];
    const diag = vec3.distance(bounds.min, bounds.max);

    // 2. Setup Scene Matrices
    const dist = diag; 
    const camPos = [center[0] + dist, center[1] + dist * 0.7, center[2] + dist];

    const projection = mat4.perspective(mat4.create(), 0.6, 1, 0.1, diag * 10);
    const view = mat4.lookAt(mat4.create(), camPos, center, [0, 1, 0]);
    const mvp = mat4.multiply(mat4.create(), projection, view);
    const model = mat4.create();

    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // Use the global program and sphere geometry
    if (prog && modelObj.vaoData) {
      gl.useProgram(prog);
      gl.bindVertexArray(modelObj.vaoData.vao);

      // Set Uniforms using the global 'locs' object
      gl.uniformMatrix4fv(locs.mvp, false, mvp);
      gl.uniformMatrix4fv(locs.model, false, model);
      gl.uniform1i(locs.mode, 0);
      
      setMaterialUniforms(modelObj.material);

      gl.uniform3fv(locs.camPos, camPos);

      gl.drawElements(gl.TRIANGLES, modelObj.vaoData.count, gl.UNSIGNED_INT, 0);
    }
  },size);

  modelObj.model.previewUrl = url;
  return url;
}

const renderPreview = (a, size) => {
  if (a instanceof Texture) return a.url;
  if (a instanceof HDRTexture) return a.generateThumbnail(size*2);
  if (a instanceof Material) return a.urlData ? a.urlData : generateMaterialPreview(a,size);
  if (a instanceof ModelData) return a.previewUrl ? a.previewUrl : generateModelPreview(a,size);
}
const renderAssets = async () => {
  await Promise.all(State.assets.map(v=>v.loaded).filter(v=>v));
  const root = document.getElementById('asset-list'); root.innerHTML = '';
  State.assets.forEach(a => {
    const el = document.createElement('div'); el.className = 'asset-item'; el.draggable = true;
    let icon = "📄"; if(a instanceof Material) icon="🎨"; if(a instanceof Texture) icon="🖼️"; if(a instanceof HDRTexture) icon="🌌"; if(a instanceof ModelData) icon="📐";
    let preview = renderPreview(a,256);
    preview = preview ? `<img class="asset-preview" src="${preview}"></img>` : `<div class="asset-icon">${icon}</div>`;
    el.innerHTML = preview+`<div class="asset-name">${a.name}</div>`;
    el.onclick = () => selectAsset(a);
    el.ondragstart = e => { e.dataTransfer.setData('assetId', a.id); e.dataTransfer.setData('type', a.type); };
    root.appendChild(el);
  });
};

// Helper for Asset Drag and Drop in GUI
const createAssetSlot = (guiFolder, label, assetType, assetParent, assetPath) => {
  const slot = document.createElement('div'); slot.className = 'tex-slot';
  slot.textContent = assetParent[assetPath] ? assetParent[assetPath].name : label;
  slot.ondragover = e => { e.preventDefault(); slot.classList.add('drag-over'); };
  slot.ondragleave = () => slot.classList.remove('drag-over');
  slot.ondrop = e => {
    const id = e.dataTransfer.getData('assetId');
    const asset = State.assets.find(a => a.id === id);
    if (asset && asset instanceof assetType) { 
      assetParent[assetPath] = asset;
      if (slot.changeListener) slot.changeListener();
      renderInspector();
    }
    slot.classList.remove('drag-over');
  };
  slot.onclick = e => {
    if (assetParent[assetPath]) selectAsset(assetParent[assetPath]);
  }
  guiFolder.domElement.children[1].appendChild(slot);
  slot.onChange = e => slot.changeListener = e;
  return slot;
};

let gui = null;
const renderInspector = () => {
  if (gui) gui.destroy(); 
  const root = document.getElementById('gui-root');
  
  // Fixed: Clear container to remove "Nothing selected" text
  root.innerHTML = ''; 

  if (!State.selected && !State.selectedAsset) { root.innerHTML = '<div style="color:#555; padding:20px; font-size:12px;">Nothing selected</div>'; return; }
  
  gui = new GUI({ container: root, autoPlace: false });
  
  if (State.selected) {
    const n = State.selected;

    const normQuat = ()=>quat.normalize(n.rotation,n.rotation);

    gui.add(n, 'name').name('Name').onFinishChange(renderList);
    const t = gui.addFolder('Transformation');
    const p = t.addFolder('Position'); p.add(n.position, 0).name('X').listen(); p.add(n.position, 1).name('Y').listen(); p.add(n.position, 2).name('Z').listen();
    const r = t.addFolder('Rotation (Quat)'); r.add(n.rotation, 0, -1, 1).name('X').listen().onChange(normQuat); r.add(n.rotation, 1, -1, 1).name('Y').listen().onChange(normQuat); r.add(n.rotation, 2, -1, 1).name('Z').listen().onChange(normQuat); r.add(n.rotation, 3, -1, 1).name('W').listen().onChange(normQuat);
    const s = t.addFolder('Scale'); s.add(n.scale, 0).name('X').listen(); s.add(n.scale, 1).name('Y').listen(); s.add(n.scale, 2).name('Z').listen();
    
    // Context Sensitive Geometry Parameters
    const geo = gui.addFolder('Geometry');
    const onGeoUpdate = () => n.updateGeo(); // Regenerate mesh on slider move
    
    if (n instanceof Sphere) {
      //geo.add(n, 'radius', 0.1, 5).name('Radius').onChange(onGeoUpdate);
    } else if (n instanceof Torus) {
      geo.add(n, 'inner_radius', 0, 1).name('Radius').onChange(onGeoUpdate);
      //geo.add(n, 'radius', 0.1, 5).name('Radius').onChange(onGeoUpdate);
      //geo.add(n, 'tube', 0.05, 2).name('Tube Radius').onChange(onGeoUpdate);
    } else if (n instanceof Cylinder) {
      geo.add(n, 'top_radius', 0, 1).name('Top Radius').onChange(onGeoUpdate);
      //geo.add(n, 'radiusTop', 0.0, 5).name('Top Radius').onChange(onGeoUpdate);
      //geo.add(n, 'radiusBottom', 0.0, 5).name('Bottom Radius').onChange(onGeoUpdate);
      //geo.add(n, 'height', 0.1, 10).name('Height').onChange(onGeoUpdate);
    } else if (n instanceof Model) {
      createAssetSlot(geo, "Drop Model Asset Here", ModelData, n, 'model');
    } else {
      //geo.domElement.innerHTML += '<div style="padding:10px; color:#666; font-size:10px">Standard Cube (No Params)</div>';
    }

    const m = gui.addFolder('Material');
    var mslot;
    n.removeMaterial = ()=>{ n.material = defaultMaterial; mslot.textContent = "None (Default) - Drop Material"; }
    m.add(n, 'removeMaterial').name('Remove Material');
    mslot = createAssetSlot(m, "None (Default) - Drop Material", Material, n, 'material');

    const ph = gui.addFolder('Physics Properties');
    const v = ph.addFolder('Velocity'); v.add(n.velocity, 0).name('X').listen(); v.add(n.velocity, 1).name('Y').listen(); v.add(n.velocity, 2).name('Z').listen();
    const av = ph.addFolder('Angular Velocity'); av.add(n.angularVelocity, 0).name('X').listen(); av.add(n.angularVelocity, 1).name('Y').listen(); av.add(n.angularVelocity, 2).name('Z').listen();
  } else if (State.selectedAsset) {
    const a = State.selectedAsset;
    gui.add(a, 'name').name('Asset Name').onFinishChange(renderAssets);
    var img = document.createElement('img');
    img.src = renderPreview(a,256);
    gui.domElement.appendChild(img);
    if (a instanceof ModelData) {
      var updateModel = ()=>{ generateModelPreview(a); img.src = renderPreview(a,256); renderAssets(); }
      function updateModelGeometry() {
        a.generateBVH();
        for (var i = 0; i < State.nodes.length; i++) {
          if (State.nodes[i].model == a) State.nodes[i].updateGeo();
        }
      }
      a.centerOrigin = ()=>{a.renormalize(false);updateModelGeometry();}
      a.bottomOrigin = ()=>{a.renormalize(true);updateModelGeometry();}

      gui.add(a, 'centerOrigin').name('Normalize Center Origin');
      gui.add(a, 'bottomOrigin').name('Normalize Bottom Origin');

      a.rotationAmount = 90;
      a.rotXdeg = ()=>{a.bakeTransform(mat4.fromRotation(mat4.create(), a.rotationAmount * Math.PI / 180, [1, 0, 0]));updateModelGeometry();}
      a.rotYdeg = ()=>{a.bakeTransform(mat4.fromRotation(mat4.create(), a.rotationAmount * Math.PI / 180, [0, 1, 0]));updateModelGeometry();}
      a.rotZdeg = ()=>{a.bakeTransform(mat4.fromRotation(mat4.create(), a.rotationAmount * Math.PI / 180, [0, 0, 1]));updateModelGeometry();}
      
      gui.add(a, 'rotationAmount', -180, 180).name('Rotation Amount');
      gui.add(a, 'rotXdeg').name('Rotate X').onChange(updateModel);
      gui.add(a, 'rotYdeg').name('Rotate Y').onChange(updateModel);
      gui.add(a, 'rotZdeg').name('Rotate Z').onChange(updateModel);

      a.faceNormals = ()=>{a.calculateFaceNormals();updateModelGeometry();}
      a.smoothNormals = ()=>{a.calculateSmoothNormals();updateModelGeometry();}
      a.sphericalUVs = ()=>{a.calculateSphericalUVs();updateModelGeometry();}
      gui.add(a, 'faceNormals').name('Calculate Face Normals').onChange(updateModel);
      gui.add(a, 'smoothNormals').name('Calculate Smooth Normals').onChange(updateModel);
      gui.add(a, 'sphericalUVs').name('Calculate Spherical UVs').onChange(updateModel);
    }
    if (a instanceof Material) {
      var updateMat = () => { generateMaterialPreview(a); img.src = renderPreview(a, 256); renderAssets(); }

      gui.addColor(a, 'color').name('Base Color').onChange(updateMat);
      gui.add(a, 'roughness', 0, 1).name('Roughness').onChange(updateMat);
      gui.add(a, 'metallic', 0, 1).name('Metallic').onChange(updateMat);
      gui.add(a, 'ior', 1, 2.5).name('IOR').onChange(updateMat);

      const disp = gui.addFolder('Disney Layers');
      disp.add(a, 'specularTint', 0, 1).name('Specular Tint').onChange(updateMat);
      //disp.add(a, 'anisotropic', 0, 1).name('Anisotropic').onChange(updateMat);
      //disp.add(a, 'anisotropicRotation', 0, 1).name('Aniso Rotation').onChange(updateMat);
      disp.add(a, 'sheen', 0, 1).name('Sheen').onChange(updateMat);
      disp.add(a, 'sheenTint', 0, 1).name('Sheen Tint').onChange(updateMat);
      
      const coat = disp.addFolder('Clear Coat');
      coat.add(a, 'clearcoat', 0, 1).name('Strength').onChange(updateMat);
      coat.add(a, 'clearcoatGloss', 0, 1).name('Gloss').onChange(updateMat);
      coat.add(a, 'clearcoatIor', 1, 2.5).name('Coat IOR').onChange(updateMat);

      const refr = gui.addFolder('Transmission & SSS');
      refr.add(a, 'transmission', 0, 1).name('Transmission').onChange(updateMat);
      refr.add(a, 'concentration', 0, 20).name('Concentration').onChange(updateMat);
      // refr.add(a, 'subsurface', 0, 1).name('Subsurface').onChange(updateMat);
      // refr.addColor(a, 'subsurfaceTint').name('SSS Tint').onChange(updateMat);
      
      const emis = gui.addFolder('Emission');
      emis.addColor(a, 'emittance').name('Color').onChange(updateMat);
      emis.add(a, 'emissionIntensity', 0, 100).name('Intensity').onChange(updateMat);

      const tex = gui.addFolder('Textures');
      tex.add(a.uvScale, '0').name("UV Scale X").onChange(updateMat);
      tex.add(a.uvScale, '1').name("UV Scale Y").onChange(updateMat);

      const maps = [
        { name: 'Emission Map', prop: 'emissiveTex', folder: emis },
        { name: 'Albedo', prop: 'albedoTex', folder: tex.addFolder('Albedo') },
        { name: 'Normal', prop: 'normalTex', folder: tex.addFolder('Normal'), extra: (nt)=>{
          nt.add(a, 'normalMultiplier').name('Multiplier').onChange(updateMat);
        }},
        { name: 'Roughness', prop: 'roughnessTex', folder: tex.addFolder('Roughness') },
        { name: 'Metallic', prop: 'metallicTex', folder: tex.addFolder('Metallic') },
        { name: 'Height / POM', prop: 'heightTex', folder: tex.addFolder('Height / POM'), extra: (ht)=>{
          ht.add(a, 'heightMultiplier').name('Depth');
          ht.add(a, 'heightSamp', 1, 64, 1).name('Samples');
          ht.add(a, 'heightOffset').name('Offset');
        }}
      ];

      maps.forEach(m => {
        if (m.extra) m.extra(m.folder);
        var slot;
        a['remove' + m.prop] = () => { a[m.prop] = null; slot.textContent = "Drop " + m.name; updateMat(); };
        m.folder.add(a, 'remove' + m.prop).name('Remove');
        slot = createAssetSlot(m.folder, "Drop " + m.name, Texture, a, m.prop).onChange(updateMat);
      });

      const ph = gui.addFolder('Physics');
      ph.add(a, 'density').name('Density');
      ph.add(a, 'friction', 0, 1).name('Friction');
      ph.add(a, 'restitution', 0, 1).name('Bounciness');
    }
  }
};
const renderSceneInspector = () => {
  if (gui) gui.destroy(); 
  const root = document.getElementById('gui-root');
  
  // Fixed: Clear container to remove "Nothing selected" text
  root.innerHTML = ''; 

  gui = new GUI({ container: root, autoPlace: false });


  const c = Cam;
  const ca = gui.addFolder('Camera');
  ca.add(c,'fov',0,180).name("FOV");
  ca.add(c,'aperture',0,1).name("Aperture");
  ca.add(c,'focusDist').name("Focus Distance");
  ca.add(c,'exposure').name("Exposure");

  const a = State;
  const bg = gui.addFolder('Background');
  bg.addColor(a,'backgroundColor').name("Color");
  bg.add(a,'backgroundIntensity').name("Intensity");
  const bgt = gui.addFolder('Background Texture');
  var bslot;
  a.removeBackground = ()=>{ a.background = null; bslot.textContent = "Drop HDR Texture Here"; }
  bgt.add(a, 'removeBackground').name('Remove Texture');
  bslot = createAssetSlot(bgt, "Drop HDR Texture Here", HDRTexture, a, 'background');
}
// Canvas Drop for Models & Materials
gl_canvas.ondragover = e => e.preventDefault();
gl_canvas.ondrop = e => {
  const id = e.dataTransfer.getData('assetId');
  const asset = State.assets.find(a => a.id === id);
  if (asset && (asset instanceof ModelData || asset instanceof Material)) {
    if (asset instanceof ModelData) {
      // Drop Model: Create Model Node automatically
      var mat = State.assets.filter(a=>a instanceof Material)[0] || defaultMaterial;
      const n = State.scene.newModel("Model ("+asset.name+")",mat, asset); 
      State.nodes.push(n); selectNode(n.id);
    } else {
      // Drop Material: Find intersected Node
      const ray = MathUtils.getRay(e.clientX, e.clientY, gl_canvas, Cam.proj, Cam.view);
      let nearest=Infinity, hit=null;
      State.nodes.forEach(n => { const t=MathUtils.rayAABB(ray, n.getBounds().min, n.getBounds().max); if(t && t<nearest){nearest=t; hit=n;} });
      if(hit) { hit.material = asset; selectNode(hit.id); }
    }
  }
};

// Add Nodes via Toolbar Dropdown
document.getElementById('primitiveSelect').oninput = (e) => {
  const type = e.target.value;
  let n;
  var mat = State.assets.filter(a=>a instanceof Material)[0] || defaultMaterial;
  if (type === 'cube') {
    n = State.scene.newCube("Cube "+State.idCounter,mat,-1,0,-1,1,2,1);
  } else if (type === 'sphere') {
    n = State.scene.newSphere("Sphere "+State.idCounter,mat,0,1,0,1);
    n.name = "Sphere " + State.idCounter;
  } else if (type === 'cylinder') {
    n = State.scene.newCylinder("Cylinder "+State.idCounter,mat).orient(0,0,0,1,0,2,0,1);
  } else if (type === 'cone') {
    n = State.scene.newCylinder("Cone "+State.idCounter,mat).orient(0,0,0,1,0,2,0,0); n.icon = "🍦";
  } else if (type === 'torus') {
    n = State.scene.newTorus("Torus "+State.idCounter,mat,1,0.5).translate(0,1,0).scaleMult(2,2,2);
  } else if (type === 'plane') {
    n = State.scene.newPlane("Plane "+State.idCounter,mat,0,1,0,0);
  }
  
  if (n) { State.nodes.push(n); selectNode(n.id); }
  e.target.value = ''; // Reset dropdown visually
};

window.createMaterial = (color) => {
  const mat = new Material("Material "+(State.assets.length+1),color||[1,1,1],0.5);
  State.assets.push(mat); renderAssets(); selectAsset(mat);
  return mat;
};
class GLBLoader {
  async load(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    
    // Validate GLB Header
    const dataView = new DataView(arrayBuffer);
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546c67) throw new Error("Not a valid GLB file.");

    const jsonLen = dataView.getUint32(12, true);
    const jsonContent = new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLen));
    const json = JSON.parse(jsonContent);
    console.log(json);

    const binChunkOffset = 20 + jsonLen + 8;
    const binaryData = arrayBuffer.slice(binChunkOffset);

    // 1. Process Materials first
    const materials = (json.materials || []).map(m => this.createMaterial(m, json, binaryData));

    // 2. Build Global World Matrices (Recursive)
    const worldMatrices = new Array(json.nodes.length).fill(null);
    const computeWorldMatrix = (nodeIdx, parentMatrix) => {
      const node = json.nodes[nodeIdx];
      let localMatrix = mat4.create();

      if (node.matrix) {
        localMatrix = mat4.clone(node.matrix);
      } else {
        const t = node.translation || [0, 0, 0];
        const r = node.rotation || [0, 0, 0, 1];
        const s = node.scale || [1, 1, 1];
        mat4.fromRotationTranslationScale(localMatrix, r, t, s);
      }

      const worldMatrix = mat4.create();
      if (parentMatrix) mat4.multiply(worldMatrix, parentMatrix, localMatrix);
      else mat4.copy(worldMatrix, localMatrix);
      
      worldMatrices[nodeIdx] = worldMatrix;

      if (node.children) {
        for (const childIdx of node.children) computeWorldMatrix(childIdx, worldMatrix);
      }
    };

    // Initialize matrix computation from scene roots
    const sceneIdx = json.scene || 0;
    for (const nodeIdx of json.scenes[sceneIdx].nodes) {
      computeWorldMatrix(nodeIdx, null);
    }

    // 3. Instantiate Models
    const instances = [];
    json.nodes.forEach((node, nodeIdx) => {
      if (node.mesh === undefined) return;

      const mesh = json.meshes[node.mesh];
      
      // Each primitive in glTF is a separate draw call with its own material
      mesh.primitives.forEach((primitive, primIdx) => {
        const modelData = new ModelData(`${mesh.name || 'Model'}_${primIdx}`);
        this.fillModelData(modelData, primitive, json, binaryData);
        
        // Build local BVH for the geometry
        modelData.generateBVH();

        const mat = primitive.material !== undefined ? materials[primitive.material] : new Material("Default");
        const modelInstance = new Model(modelData.name, mat, modelData);

        // Apply calculated World Matrix
        const worldM = worldMatrices[nodeIdx];
        mat4.invert(modelInstance.invMatrix, worldM);

        instances.push(modelInstance);
      });
    });


    var mats = [];
    for (var i = 0; i < instances.length; i++) {
      var m = instances[i].material || instances[i];
      if (m && !mats.includes(m)) mats.push(m);
    }
    var texs = [];
    for (var i = 0; i < mats.length; i++) {
      ['emissiveTex', 'albedoTex', 'normalTex', 'heightTex', 'roughnessTex', 'metallicTex'].forEach(t => {
        t = mats[i][t];
        if (t && !texs.includes(t)) texs.push(t);
      });
    }
    for (var i = 0; i < texs.length; i++) await texs[i].loaded;

    return { models:instances, mats, texs };
  }

  fillModelData(modelData, primitive, json, bin) {
    const getBuffer = (accessorIdx) => {
      if (accessorIdx === undefined) return null;
      const acc = json.accessors[accessorIdx];
      const view = json.bufferViews[acc.bufferView];
      const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
      
      // Map component types
      if (acc.componentType === 5126) return new Float32Array(bin, offset, acc.count * (acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : 1));
      if (acc.componentType === 5123) return new Uint16Array(bin, offset, acc.count);
      if (acc.componentType === 5125) return new Uint32Array(bin, offset, acc.count);
      return null;
    };

    modelData.vertex_positions = new Float32Array(getBuffer(primitive.attributes.POSITION));
    const normals = getBuffer(primitive.attributes.NORMAL);
    const uvs = getBuffer(primitive.attributes.TEXCOORD_0);
    const indices = getBuffer(primitive.indices);

    if (normals) modelData.vertex_normals = new Float32Array(normals);
    if (uvs) modelData.vertex_texcoords = new Float32Array(uvs);
    
    modelData.index_positions = indices instanceof Uint16Array ? new Uint32Array(indices) : indices;
    modelData.index_normals = new Uint32Array(modelData.index_positions);
    modelData.index_texcoords = new Uint32Array(modelData.index_positions);
  }

  createMaterial(gltfMat, json, bin) {
    const pbr = gltfMat.pbrMetallicRoughness || {};
    const ext = gltfMat.extensions || {};

    const options = {
      metallic: pbr.metallicFactor ?? 1.0,
      roughness: pbr.roughnessFactor ?? 1.0,
      ior: ext.KHR_materials_ior?.ior ?? 1.5,
      transmission: ext.KHR_materials_transmission?.transmissionFactor ?? 0.0,
      
      // Clearcoat
      clearcoat: ext.KHR_materials_clearcoat?.clearcoatFactor ?? 0.0,
      clearcoatGloss: 1.0 - (ext.KHR_materials_clearcoat?.clearcoatRoughnessFactor ?? 0.0),
      clearcoatIor: 1.5, // Standard fallback
      
      // Sheen
      sheen: ext.KHR_materials_sheen?.sheenColorFactor ? 1.0 : 0.0,
      sheenTint: 0.5,
      
      // Specular/Disney Tint
      specularTint: ext.KHR_materials_specular?.specularColorFactor ? 1.0 : 0.0,
      
      // Emission
      emittance: gltfMat.emissiveFactor || [0, 0, 0],
      emissionIntensity: ext.KHR_materials_emissive_strength?.emissiveStrength ?? 1.0,
    };

    const baseColor = pbr.baseColorFactor ? [pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2]] : [1, 1, 1];

    // Map Textures
    var name = gltfMat.name || "GLB_Mat";
    if (pbr.baseColorTexture) options.albedoTex = this.extractTexture(pbr.baseColorTexture.index, json, bin, name+"_baseColor");
    if (gltfMat.normalTexture) options.normalTex = this.extractTexture(gltfMat.normalTexture.index, json, bin, name+"_normal");
    if (pbr.metallicRoughnessTexture) options.roughnessTex = options.metallicTex = this.extractTexture(pbr.metallicRoughnessTexture.index, json, bin, name+"_metallicRoughness");
    if (gltfMat.emissiveTexture) options.emissiveTex = this.extractTexture(gltfMat.emissiveTexture.index, json, bin, name+"_emissive");

    return new Material(name, baseColor, options.roughness, options);
  }

  extractTexture(idx, json, bin, name) {
    const texture = json.textures[idx];
    const image = json.images[texture.source];
    if (image.bufferView !== undefined) {
      const view = json.bufferViews[image.bufferView];
      const blob = new Blob([new Uint8Array(bin, view.byteOffset, view.byteLength)], { type: image.mimeType });
      return new Texture(URL.createObjectURL(blob), name);
    }
    return new Texture(image.uri, name); // Fallback for external URI (rare in GLB)
  }
}
window.handleUpload = (input) => {
  const files = Array.from(input.files);
  
  files.forEach(async (file) => {
    var name = file.name.toLowerCase();
    const isOBJ = name.endsWith('.obj');
    const isImage = /\.(jpe?g|png|webp)$/i.test(name);
    const isHDR = name.endsWith('.hdr');

    if (name.endsWith('.glb')) {
      const loader = new GLBLoader();
      try {
        // Create an object URL for the uploaded file
        const url = URL.createObjectURL(file);
        
        // The loader parses the hierarchy and returns an array of Model instances
        const {models, mats, texs} = await loader.load(url);
        
        models.forEach(model => {
          // Add to your global scene or object list
          console.log(model);
          State.scene.objects.push(model); 
          State.nodes.push(model);
          State.assets.push(model.model);

          // Optional: Trigger a UI update or sidebar refresh
          console.log(`Added GLB component: ${model.name}`);
        });

        State.assets = State.assets.concat(mats);
        State.assets = State.assets.concat(texs);

        renderAssets();
        selectNode(models[0].id);

        // Cleanup the temporary URL
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Failed to load GLB:", err);
      }
      return;
    }

    if (isOBJ) {
      const url = URL.createObjectURL(file);
      const model = await new ModelData(file.name).loadOBJ(url).loaded;
      model.renormalize();
      model.generateBVH();
      State.assets.push(model);

      renderAssets();
      URL.revokeObjectURL(url);
      console.log(`Model ${file.name} processed and added to assets.`);
    } else if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const tex = new Texture(e.target.result, file.name);
        State.assets.push(tex);
        renderAssets();
      };
      reader.readAsDataURL(file);
    } else if (isHDR) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const tex = new HDRTexture(e.target.result, file.name);
        State.assets.push(tex);
        renderAssets();
      };
      reader.readAsDataURL(file);
    }
  });
};

const ctxMenu = document.getElementById('context-menu');
document.getElementById("ctx-add-animation").onclick = () => {
  if (State.selected) {
    AnimationPanel.addItem(State.selected.id, State.selected.name);
    // Switch to animation tab
    const animTab = document.querySelector('[data-tab="animation"]');
    if (animTab) animTab.click();
  }
  ctxMenu.style.display = "none";
};
document.getElementById("ctx-insert-keyframe").onclick = () => {
  if (State.selected) {
    AnimationPanel.insertKeyframe(State.selected.id);
  }
  ctxMenu.style.display = "none";
};
document.getElementById('ctx-delete').onclick = () => { 
  if (State.selected) State.nodes = State.nodes.filter(n => n.id !== State.selected.id); 
  if (State.selectedAsset) {
    var a = State.selectedAsset;
    State.assets = State.assets.filter(n => n.id !== a.id); 
    if (State.background == a) State.background = null;
    State.nodes.forEach(n=>{
      if (a instanceof Material && n.material == a) n.material = defaultMaterial; 
      if (a instanceof Texture) {
        if (n.albedoTex == a) n.albedoTex = null;
        if (n.normalTex == a) n.normalTex = null;
        if (n.heightTex == a) n.heightTex = null;
        if (n.roughnessTex == a) n.roughnessTex = null;
      }
    });
  }
  selectAsset(null);
  selectNode(null);
  ctxMenu.style.display='none';
};
document.getElementById('ctx-duplicate').onclick = () => { 
  if (State.selected) {
    var o = State.selected;
    var c = new o.constructor(o.name,o.material);
    for (var i in o) {
      if (i != "id") c[i] = o[i];
      if (c[i] instanceof Array) c[i] = new Array(...c[i]);
      if (c[i] instanceof Float32Array) c[i] = new Float32Array(c[i]);
    }
    o.vaoData = null;
    State.scene.objects.push(c);
    State.nodes.push(c);
    selectNode(c.id);
  }
};
window.onclick = () => {
  ctxMenu.style.display = "none";
  const keyframeMenu = document.getElementById("keyframe-context-menu");
  if (keyframeMenu) keyframeMenu.style.display = "none";
};
window.onkeydown = e => { 
  if (e.key === 'Delete' || e.key === 'Backspace') document.getElementById('ctx-delete').click(); 
  if (e.target.tagName.match(/INPUT/)) return;
  if (e.key === 't') setTool('t'); 
  if (e.key === 'r') setTool('r'); 
  if (e.key === 's') setTool('s');
  if (e.key === 'b') renderSceneInspector();
  if (e.key === 'c' && State.selected) Cam.target = vec3.fromValues(...State.selected.position);
};

const setTool = t => { State.tool=t; document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active', b.id==='tool-'+t)); };
['tool-t','tool-r','tool-s'].forEach(id => document.getElementById(id).onclick = () => setTool(id.split('-')[1]));


function updateSceneCam() {
  const c = document.getElementById('gpuCanvas');
  Cam.update(c.width/c.height);
  var cam = State.scene.camera;
  cam.position = vec3.fromValues(...Cam.position);
  cam.target = vec3.fromValues(...Cam.target);
  cam.updateRays();
  if (renderer) renderer.reset();
}
gl_canvas.onmousedown = e => {
  const ray = MathUtils.getRay(e.clientX, e.clientY, gl_canvas, Cam.proj, Cam.view), gizmo = Interact.testGizmo(ray);
  if (gizmo && e.button===0) { Interact.startDrag(gizmo, ray); return; }
  let nearest=Infinity, hit=null;
  State.nodes.forEach(n => { const t=MathUtils.rayAABB(ray, n.getBounds().min, n.getBounds().max); if(t && t<nearest){nearest=t; hit=n;} });
  if(e.button===0) selectNode(hit?.id||null);
  
  // Shift+LMB OR RMB to Pan
  Cam.isOrbiting = (e.button === 0 && !e.shiftKey);
  Cam.isPanning = (e.button === 2 || (e.button === 0 && e.shiftKey));
  Cam.lastM = [e.clientX, e.clientY];
  Cam.updateSceneCam = false;
};
document.getElementById('gpuCanvas').onmousedown = e => {
  // Shift+LMB OR RMB to Pan
  Cam.isOrbiting = (e.button === 0 && !e.shiftKey);
  Cam.isPanning = (e.button === 2 || (e.button === 0 && e.shiftKey));
  Cam.lastM = [e.clientX, e.clientY];
  Cam.updateSceneCam = true;
};
window.onmousemove = e => {
  if (Interact.activeAxis) Interact.updateDrag(MathUtils.getRay(e.clientX, e.clientY, gl_canvas, Cam.proj, Cam.view));
  else if (Cam.isOrbiting || Cam.isPanning) {
    const dx = e.clientX - Cam.lastM[0], dy = e.clientY - Cam.lastM[1]; Cam.lastM = [e.clientX, e.clientY];
    if (Cam.isOrbiting) { 
      Cam.orbit.theta+=dx*0.007; 
      Cam.orbit.phi=Math.max(0.1, Math.min(Math.PI-0.1, Cam.orbit.phi-dy*0.007));
    } else { 
      const dist=Cam.orbit.radius*0.0015;
      vec3.scaleAndAdd(Cam.target, Cam.target, [Cam.view[0], Cam.view[4], Cam.view[8]], -dx*dist);
      vec3.scaleAndAdd(Cam.target, Cam.target, [Cam.view[1], Cam.view[5], Cam.view[9]], dy*dist); 
    }
    if (Cam.updateSceneCam) updateSceneCam();
  }
};
window.onmouseup = () => { 
  Interact.activeAxis = null; 
  Cam.isOrbiting = Cam.isPanning=false;
};
gl_canvas.onwheel = e => { 
  Cam.orbit.radius = Math.max(1, Cam.orbit.radius+e.deltaY*0.01); 
  e.preventDefault();
};
document.getElementById('gpuCanvas').onwheel = e => {
  // Shift+LMB OR RMB to Pan
  gl_canvas.onwheel(e);
  updateSceneCam();
};

const setupGutter = (gid, pid, axis) => {
  const g=document.getElementById(gid), p=document.getElementById(pid);
  g.onmousedown = e => {
    const start=axis==='x'?e.clientX:e.clientY, startS=axis==='x'?p.offsetWidth:p.offsetHeight;
    const move = ev => { const d=(axis==='x'?ev.clientX:ev.clientY)-start; const dir=(gid.includes('right')||gid.includes('bottom'))?-1:1; p.style[axis==='x'?'width':'height']=(startS+(d*dir))+'px'; };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
};
setupGutter('gutter-left','left-panel','x');
setupGutter('gutter-right','right-panel','x'); 
setupGutter('gutter-bottom','bottom-panel','y');
document.querySelectorAll(".panel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = tab.getAttribute("data-tab");
    // Remove active class from all tabs and panes
    document.querySelectorAll(".panel-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    // Add active class to clicked tab and corresponding pane
    tab.classList.add("active");
    document.getElementById(tabName + "-tab").classList.add("active");
    document.getElementById("asset-adder").classList[tabName == "assets" ? "add" : "remove"]("active"); 
  });
});

var renderActive = null;
async function loop() { 
  if (renderActive) {
    await renderActive();
  } else {
    Cam.update(gl_canvas.width/gl_canvas.height); 
    draw();
  }
  requestAnimationFrame(loop);
}

// Initial Setup
const initNode = State.scene.newCube("Cube 1",createMaterial([0.8,0.8,0.8]),-1,0,-1,1,2,1);
State.nodes.push(initNode); selectNode(initNode.id); renderAssets(); initializeAnimation(); loop();

function openRenderPopup() {
  const modal = document.getElementById('render-modal');
  modal.style.display = 'flex';
  
  // Set canvas size to match the inputs initially
  const canvas = document.getElementById('gpuCanvas');
  canvas.width = document.getElementById('render-w').value;
  canvas.height = document.getElementById('render-h').value;
  var cam = State.scene.camera;
  cam.aspect = canvas.width / canvas.height;
  cam.updateRays();
  if (renderer) renderer.clear();

  document.getElementById('render-stats').innerText = 'Status: Ready';
  document.getElementById('spp').innerText = "0";
}

var renderer;
function SaveRender(name) {
  console.log("Saved Render");
  const canvas = document.getElementById('gpuCanvas');
  const url = canvas.toDataURL('image/jpeg', 0.95);
  const link = document.createElement('a');
  link.href = url;
  link.download = (name||'render')+'.jpeg';
  document.body.appendChild(link);
  link.click();
}
function updateScene(scene) {
  scene.objects = State.nodes//.filter(n=>n.type!="Camera");
  var col = State.backgroundColor;
  var mod = State.backgroundIntensity;
  if (!State.background) scene.background = new HDRTexture([col[0]*mod,col[1]*mod,col[2]*mod,1]);
  else scene.background = State.background;
  scene.bounces = Number(document.getElementById('render-bounces').value);

  scene.camera.position = Cam.position;
  scene.camera.target = Cam.target;
  scene.camera.fov = Cam.fov;
  scene.camera.aperture = Cam.aperture;
  scene.camera.focusDist = Cam.focusDist;
  scene.camera.exposure = Cam.exposure;
  scene.camera.updateRays();
}
var sceneLoaded = false;
function startClicked() {
  if (renderActive && sceneLoaded) {
    SaveRender('render-'+renderer.frame);
    return;
  }
  var type = Number(prompt("Enter type:\nPhoto = 0, Animation = 1, Simulation = 2")||0);
  if (type == 1) {
    var fps = Number(prompt("Enter framerate:","24")||24);
    var spp = Number(prompt("Enter samples per pixel:","128")||128);
    var dur = 0;
    for (var i of AnimationPanel.keyframes) {
      for (var j = 0; j < i[1].length; j++) dur = Math.max(dur,i[1][j].time);
    }
    if (dur > 0) startAnimation(fps,spp,dur);
  } else if (type == 2) {
    var fps = Number(prompt("Enter framerate:","24")||24);
    var spp = Number(prompt("Enter samples per pixel:","128")||128);
    var dur = Number(prompt("Enter duration:","1")||1);
    var psps = Number(prompt("Enter physics steps per second:","120")||120);
    startSimulation(fps,spp,dur,psps);
  } else {
    startRender();
  }
}
async function startRender() {
  const canvas = document.getElementById('gpuCanvas');
  const status = document.getElementById('render-stats');
  sceneLoaded = false;
  status.innerText = 'Status: Loading Scene...';

  renderer = new Renderer(canvas);
  await renderer.init();
  
  //var scene = await SceneList[SelectedScene].create(canvas);
  const scene = State.scene;
  updateScene(scene);
  await renderer.setScene(scene);

  sceneLoaded = true;
  status.innerText = 'Status: Rendering...';

  const sppElement = document.getElementById('spp');
  renderActive = async function() {
    renderer.render();
    sppElement.innerText = renderer.frame;
  }

  document.getElementById('btn-start-render').textContent = "SAVE RENDER";
}
async function startAnimation(fps,samples,duration) {
  await RecordVideo((time)=>{
    AnimationPanel.currentTime = time;
    AnimationPanel.updateAnimatedEntities();
    return true;
  },fps,samples,duration,()=>{
    AnimationPanel.currentTime = 0;
    AnimationPanel.updateUI();
  });
}
async function startSimulation(fps,spp,dur,psps) {
  //var samp = parseInt(document.getElementById("samples").value);
  //var fps = parseInt(document.getElementById("fps").value);
  //var dur = parseFloat(document.getElementById("duration").value);

  var physics = new PhysicsController(State.scene);
  var motionblur = true;
  const dt = 1 / psps;
  RecordVideo((time,counter)=>{
    if (time == 0) return;
    if (motionblur) {
      physics.setTime(time,dt);
    } else {
      if (counter % spp !== 0) return;
      physics.setTime(time,dt);
    }
    return true;
  },fps,spp,dur,()=>{
    physics.reset();
  });
}
function simulate(dur,psps,animate,areset) {
  animate = confirm("Add to animator?");
  areset = animate && confirm("Reset the animator?");
  dur = Number(prompt("Enter duration:","1")||1);
  psps = Number(prompt("Enter physics steps per second:","120")||120);

  var physics = new PhysicsController(State.scene);
  const dt = 1 / psps;
  var time = 0;
  var startingTime = AnimationPanel.currentTime;
  if (areset) {
    startingTime = 0;
    for (var body of physics.bodies) AnimationPanel.removeItem(body.renderer.id,true);
  }
  var interval = setInterval(()=>{
    physics.setTime(time,dt);
    time += dt;
    if (animate) {
      AnimationPanel.currentTime = startingTime+time;
      for (var body of physics.bodies) AnimationPanel.insertKeyframe(body.renderer.id,true);
    }
    if (time > dur) {
      physics.reset();
      clearInterval(interval);
      if (animate) {
        AnimationPanel.render();
        AnimationPanel.updateSeeker();
        AnimationPanel.updateUI();
      }
    }
  },1000*dt);
}
async function RecordVideo(animate,fps,samples,duration,callback) {
  const canvas = document.getElementById('gpuCanvas');
  const status = document.getElementById('render-stats');
  sceneLoaded = false;
  status.innerText = 'Status: Loading Scene...';

  //if (!renderer) {
    renderer = new Renderer(canvas);
    await renderer.init();
  //}
  
  console.log("Begin Recording");
  
  var encoder = new Whammy.Video(fps); 
  window._encoder = encoder;

  var scene = State.scene;
  animate(0);
  updateScene(scene);
  await renderer.setScene(scene);

  sceneLoaded = true;
  status.innerText = 'Status: Rendering...';

  if (typeof animate !== 'function') animate = ()=>{};

  var frames = Math.ceil(fps*duration);
  const sppElement = document.getElementById('spp');
  var counter = 0;
  renderActive = async function() {
    if (encoder._stop) renderActive = null;
    counter++;
    var time = counter / fps / samples;
    if (animate(time,counter)) await renderer.updateObjects();
    if (counter % samples == 0) {
      status.innerText = "Status: Rendered Frame "+Math.floor(counter/samples)+"/"+frames;
      var data = canvas.toDataURL('image/webp', 0.95);
      encoder.add(data);
      renderer.reset();
    }
    renderer.render();
    sppElement.innerText = renderer.frame + " / " + samples;
    if (counter >= samples*frames || encoder._saveEarly) {
      console.log("Starting Compile");
      status.innerText = 'Status: Starting Compile';
      console.log(encoder);
      encoder.compile(false, output => {
        console.log("Compiled");
        
        var url = (window.webkitURL || window.URL).createObjectURL(output);
        //console.log(url);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = 'recording.webm';
        document.body.appendChild(link);
        link.click();
        
        //*
        (window.webkitURL || window.URL).revokeObjectURL(url);
        /*/
        const video = document.createElement('video');
        video.src = url;
        video.addEventListener('error', (e) => {
          console.error('Video playback error:', e.target.error);
          console.log('Error details:', {
            code: e.target.error.code,
            message: e.target.error.message
          });
        });
        video.addEventListener('loadedmetadata', () => {
          console.log('Video metadata:', {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight
          });
        });
        document.body.appendChild(video);
        */
        
        if (typeof callback == 'function') callback(output);
        renderActive = null;
        status.innerText = 'Status: Finished!';
        renderer.clear();
        console.log("End Recording");
      });
    }
  }
}

function closeRenderPopup() {
  document.getElementById('render-modal').style.display='none';
  if (window._encoder) {
    window._encoder._saveEarly = true;
  } else {
    renderActive = null;
  }
  document.getElementById('btn-start-render').textContent = "START RENDER";
}

// Logic to resize canvas when user changes inputs
document.getElementById('render-w').onchange = (e) => {
  //if (renderActive) return;
  const canvas = document.getElementById('gpuCanvas');
  canvas.width = e.target.value;
  var cam = State.scene.camera;
  cam.aspect = canvas.width / canvas.height;
  cam.updateRays(); 
  if (renderer) renderer.resize();
};
document.getElementById('render-h').onchange = (e) => {
  //if (renderActive) return;
  const canvas = document.getElementById('gpuCanvas');
  canvas.height = e.target.value;
  var cam = State.scene.camera;
  cam.aspect = canvas.width / canvas.height;
  cam.updateRays(); 
  if (renderer) renderer.resize();
};
