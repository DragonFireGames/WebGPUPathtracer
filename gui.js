
const { GUI } = lil;
//const { vec3, vec4, mat4, quat } = glMatrix;

class CameraController {
  constructor() {
    this.target = [0, 1, 0]; this.orbit = { theta: 0.5, phi: 1.2, radius: 10 };
    this.position = vec3.create(); this.view = mat4.create(); this.proj = mat4.create();
    this.isPanning = false; this.isOrbiting = false;
  }
  update(aspect) {
    mat4.perspective(this.proj, 0.75, aspect, 0.1, 1000);
    this.position[0] = this.target[0] + this.orbit.radius * Math.sin(this.orbit.phi) * Math.cos(this.orbit.theta);
    this.position[1] = this.target[1] + this.orbit.radius * Math.cos(this.orbit.phi);
    this.position[2] = this.target[2] + this.orbit.radius * Math.sin(this.orbit.phi) * Math.sin(this.orbit.theta);
    mat4.lookAt(this.view, this.position, this.target, [0, 1, 0]);
  }
}

const Cam = new CameraController();

const defaultMaterial = new Material("Default Material",0,[0.8,0.8,0.8],0.5,[0,0,0,0]);
defaultMaterial.name = "Default Material";
var renderCanvas = document.createElement('canvas');
const State = { tool: 't', scene: new Scene(renderCanvas), nodes: [], assets: [], selected: null, selectedAsset: null, idCounter: 1 };
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
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: true });

// Prevent context menu to allow smooth RMB panning
canvas.addEventListener('contextmenu', e => e.preventDefault());

const prog = gl.createProgram();
const vs = `#version 300 es
  layout(location=0) in vec3 a_pos; 
  layout(location=1) in vec3 a_norm;
  layout(location=2) in vec2 a_uv;

  uniform mat4 u_mvp; 
  uniform mat4 u_model; 
  
  out vec3 v_norm;
  out vec3 v_worldPos;
  out vec2 v_uv;

  void main() { 
    vec4 worldPos = u_model * vec4(a_pos, 1.0);
    v_worldPos = worldPos.xyz;
    gl_Position = u_mvp * vec4(a_pos, 1.0); 
    v_norm = mat3(u_model) * a_norm; 
    v_uv = a_uv;
  }`;

const fs = `#version 300 es
  precision highp float; 
  in vec3 v_norm; 
  in vec3 v_worldPos;
  in vec2 v_uv;

  uniform vec4 u_color; 
  uniform vec3 u_emittance; 
  uniform int u_mode; 
  uniform sampler2D u_albedoTex;
  uniform sampler2D u_normalTex;
  uniform bool u_hasAlbedo;
  uniform bool u_hasNormal;

  out vec4 outColor;

  // Function to calculate normal from normal map using screen-space derivatives
  vec3 getNormal(vec2 uv) {
    vec3 tangentNormal = texture(u_normalTex, uv).xyz * 2.0 - 1.0;

    vec3 q1 = dFdx(v_worldPos);
    vec3 q2 = dFdy(v_worldPos);
    vec2 st1 = dFdx(uv);
    vec2 st2 = dFdy(uv);

    vec3 N = normalize(v_norm);
    vec3 T = normalize(q1 * st2.t - q2 * st1.t);
    vec3 B = -normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);

    return normalize(TBN * tangentNormal);
  }

  void main() {
    vec2 uv = vec2(v_uv.x,1.0-v_uv.y);
    vec4 texColor = u_hasAlbedo ? texture(u_albedoTex, uv) : vec4(1.0);
    
    if(u_mode == 0) { 
      // Use perturbed normal if map exists, otherwise use vertex normal
      vec3 n = u_hasNormal ? getNormal(uv) : normalize(v_norm); 
      
      float light = max(dot(n, normalize(vec3(1,2,3))), 0.4);
      vec4 diffuse = vec4(u_color.rgb * texColor.rgb * light, u_color.a * texColor.a); 
      outColor = diffuse + vec4(u_emittance,0.);
    } else {
      outColor = u_color;
    }
  }`;
const sh = (t, s) => { const x=gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); gl.attachShader(prog, x); };
sh(gl.VERTEX_SHADER, vs); sh(gl.FRAGMENT_SHADER, fs); gl.linkProgram(prog);
const locs = { 
  mvp: gl.getUniformLocation(prog, "u_mvp"), 
  model: gl.getUniformLocation(prog, "u_model"), 
  color: gl.getUniformLocation(prog, "u_color"), 
  emittance: gl.getUniformLocation(prog, "u_emittance"), 
  mode: gl.getUniformLocation(prog, "u_mode"),
  hasAlbedo: gl.getUniformLocation(prog, "u_hasAlbedo"),
  hasNormal: gl.getUniformLocation(prog, "u_hasNormal"),
  albedoTex: gl.getUniformLocation(prog, "u_albedoTex"),
  normalTex: gl.getUniformLocation(prog, "u_normalTex")
};

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

  const iBuf = b(new Uint16Array(i), gl.ELEMENT_ARRAY_BUFFER); 
  
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

function draw() {
  const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
  if(canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
  gl.viewport(0,0,w,h); gl.clearColor(0.09, 0.09, 0.09, 1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.useProgram(prog);
  const vp = mat4.mul(mat4.create(), Cam.proj, Cam.view);

  // Draw Grid
  gl.uniformMatrix4fv(locs.mvp, false, vp); gl.uniformMatrix4fv(locs.model, false, mat4.create());
  gl.uniform1i(locs.mode, 1); gl.uniform4f(locs.color, 0.2, 0.2, 0.2, 1);
  gl.bindVertexArray(gridGeo.vao); gl.drawElements(gl.LINES, gridGeo.count, gl.UNSIGNED_SHORT, 0);

  State.nodes.forEach(n => {
    n.updateMatrix(); const mvp = mat4.mul(mat4.create(), vp, n.matrix);
    gl.uniformMatrix4fv(locs.mvp, false, mvp); gl.uniformMatrix4fv(locs.model, false, n.matrix);
    
    // Draw Dynamic Node Geometry
    if (!n.vaoData) n.updateGeo(); 
    gl.bindVertexArray(n.vaoData.vao);
    gl.uniform1i(locs.mode, 0);

    function uniformTexture(texloc,hastexloc,tex,index) {
      let hasTexture = false;
      if (tex) {
        if (!tex.glTexture && tex.image.complete) {
          window.uploadTextureToGPU(tex);
        }
        if (tex.glTexture) {
          gl.activeTexture(gl["TEXTURE"+index]);
          gl.bindTexture(gl.TEXTURE_2D, tex.glTexture);
          gl.uniform1i(texloc, index);
          hasTexture = true;
        }
      }
      gl.uniform1i(hastexloc, hasTexture ? 1 : 0);
    }

    // Albedo Texture
    if (n.material) uniformTexture(locs.albedoTex,locs.hasAlbedo,n.material.albedoTex,0)
    else gl.uniform1i(locs.hasAlbedo, 0);

    if (n.material) uniformTexture(locs.normalTex,locs.hasNormal,n.material.normalTex,1)
    else gl.uniform1i(locs.hasNormal, 0);

    let color = [0.8,0.8,0.8,1.0];
    if (n.material) color = [...n.material.color, 1];
    gl.uniform4fv(locs.color, color);

    let emittance = [0,0,0];
    if (n.material) emittance = n.material.emittance.map(v=>v*n.material.emissionIntensity);
    gl.uniform3fv(locs.emittance, emittance);

    gl.drawElements(gl.TRIANGLES, n.vaoData.count, gl.UNSIGNED_SHORT, 0);
    
    // Draw Selection Highlight (Using the scalable wireframe box)
    // if(State.selected?.id === n.id) {
    //   var bounds = n.getBounds();
    //   var selmat = mat4.create();
    //   mat4.translate(selmat, selmat, [0,1,2].map(i=>(bounds.max[i]+bounds.min[i])/2+0.001));
    //   mat4.scale(selmat, selmat, [0,1,2].map(i=>bounds.max[i]-bounds.min[i]));
    //   n.updateMatrix(); const mvp = mat4.mul(mat4.create(), vp, selmat);
    //   gl.uniformMatrix4fv(locs.mvp, false, mvp); gl.uniformMatrix4fv(locs.model, false, selmat);
    //   gl.uniform1i(locs.mode, 1); gl.uniform4f(locs.color, 1, 1, 1, 1);
      
    //   // For models and complex objects, highlighting the AABB bounds is usually best
    //   gl.bindVertexArray(lineCubeGeo.vao); 
    //   gl.drawElements(gl.LINES, lineCubeGeo.count, gl.UNSIGNED_SHORT, 0);
    // }
  });

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
    gl.drawElements(gl.LINES, lineCubeGeo.count, gl.UNSIGNED_SHORT, 0);

    if (State.tool === 't') {
      [{id:'x',c:[1,0,0,1],r:[0,0,-Math.PI/2]},{id:'y',c:[0,1,0,1],r:[0,0,0]},{id:'z',c:[0,0,1,1],r:[Math.PI/2,0,0]}].forEach(a => {
        let m = mat4.clone(gPos); mat4.rotateX(m,m,a.r[0]); mat4.rotateZ(m,m,a.r[2]);
        let stem = mat4.scale(mat4.clone(m), mat4.translate(mat4.clone(m), m, [0, 0.5*s, 0]), [0.03*s, 1*s, 0.03*s]);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, stem));
        gl.uniform4fv(locs.color, Interact.activeAxis===a.id?[1,1,0,1]:a.c); gl.uniform1i(locs.mode, 1);
        gl.bindVertexArray(cubeGeo.vao); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_SHORT, 0);
      });
      [{id:'xy',c:[1,1,0,0.3],r:[-Math.PI/2,0,0]},{id:'yz',c:[0,1,1,0.3],r:[0,0,Math.PI/2]},{id:'xz',c:[1,0,1,0.3],r:[0,0,0]}].forEach(p => {
        let m = mat4.clone(gPos); mat4.rotateX(m,m,p.r[0]); mat4.rotateZ(m,m,p.r[2]);
        mat4.translate(m,m,[0.2*s,0,0.2*s]); mat4.scale(m,m,[0.4*s,0.01,0.4*s]);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, m)); gl.uniform4fv(locs.color, Interact.activeAxis===p.id?[1,1,0,0.7]:p.c);
        gl.uniform1i(locs.mode, 1);
        gl.bindVertexArray(cubeGeo.vao); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_SHORT, 0);
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
        gl.bindVertexArray(cubeGeo.vao); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_SHORT, 0);
        let head = mat4.scale(mat4.clone(m), mat4.translate(mat4.clone(m), m, [0, 1.1*s, 0]), [0.15*s, 0.15*s, 0.15*s]);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, head)); gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_SHORT, 0);
      });
      let mCenter = mat4.clone(gPos); mat4.mul(mCenter, mCenter, gRot);
      let centerCube = mat4.scale(mat4.create(), mCenter, [0.25 * s, 0.25 * s, 0.25 * s]);
      gl.uniform1i(locs.mode, 1);
      gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, centerCube));
      gl.uniform4fv(locs.color, Interact.activeAxis === 'all' ? [1, 1, 0, 1] : [1, 1, 1, 1]);
      gl.bindVertexArray(cubeGeo.vao);
      gl.drawElements(gl.TRIANGLES, cubeGeo.count, gl.UNSIGNED_SHORT, 0);
    } else if (State.tool === 'r') {
      [{id:'x',c:[1,0,0,1],r:[0,0,Math.PI/2]},{id:'y',c:[0,1,0,1],r:[0,0,0]},{id:'z',c:[0,0,1,1],r:[Math.PI/2,0,0]}].forEach(r => {
        let m = mat4.clone(gPos); mat4.rotateX(m,m,r.r[0]); mat4.rotateZ(m,m,r.r[2]); mat4.scale(m,m,[s,s,s]);
        gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, m)); gl.uniform4fv(locs.color, Interact.activeAxis===r.id?[1,1,0,1]:r.c);
        gl.uniform1i(locs.mode, 1);
        gl.bindVertexArray(circleGeo.vao); gl.drawElements(gl.LINES, circleGeo.count, gl.UNSIGNED_SHORT, 0);
      });
      let outer = mat4.targetTo(mat4.create(), State.selected.position, Cam.position, [0,1,0]);
      mat4.rotateX(outer, outer, Math.PI/2); mat4.scale(outer, outer, [s*1.3, s*1.3, s*1.3]);
      gl.uniformMatrix4fv(locs.mvp, false, mat4.mul(mat4.create(), vp, outer)); gl.uniform4fv(locs.color, Interact.activeAxis==='cam'?[1,1,0,1]:[1,1,1,0.5]);
      gl.uniform1i(locs.mode, 1);
      gl.drawElements(gl.LINES, circleGeo.count, gl.UNSIGNED_SHORT, 0);
    }
  }
}

const selectNode = id => { State.selected = State.nodes.find(n => n.id === id) || null; State.selectedAsset=null; renderList(); renderInspector(); };
const selectAsset = asset => { State.selectedAsset = asset; State.selected=null; renderAssets(); renderInspector(); };

const renderList = () => {
  const root = document.getElementById('node-list'); root.innerHTML = '';
  State.nodes.forEach(n => {
    const el = document.createElement('div'); el.className = `node-item ${State.selected?.id === n.id ? 'selected' : ''}`;
    el.innerHTML = `<span>${n.icon}</span> ${n.name}`; el.onclick = () => selectNode(n.id);
    el.oncontextmenu = e => { e.preventDefault(); selectNode(n.id); ctxMenu.style.display='block'; ctxMenu.style.left=e.clientX+'px'; ctxMenu.style.top=e.clientY+'px'; };
    el.ondragover = e => e.preventDefault();
    el.ondrop = e => {
      const assetId = e.dataTransfer.getData('assetId');
      const asset = State.assets.find(a => a.id === assetId);
      if (asset && asset instanceof Material) { n.material = asset; renderInspector(); }
    };
    root.appendChild(el);
  });
};

const renderAssets = () => {
  const root = document.getElementById('asset-list'); root.innerHTML = '';
  State.assets.forEach(a => {
    const el = document.createElement('div'); el.className = 'asset-item'; el.draggable = true;
    let icon = "📄"; if(a instanceof Material) icon="🎨"; if(a instanceof Texture) icon="🖼️"; if(a instanceof HDRTexture) icon="🌌"; if(a instanceof ModelData) icon="📐";
    el.innerHTML = `<div class="asset-icon">${icon}</div><div class="asset-name">${a.name}</div>`;
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
      renderInspector();
    }
    slot.classList.remove('drag-over');
  };
  slot.onclick = e => {
    if (assetParent[assetPath]) selectAsset(assetParent[assetPath]);
  }
  guiFolder.domElement.appendChild(slot);
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
    } else if (n instanceof Frustum) {
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
    var mslot = createAssetSlot(m, "None (Default) - Drop Material", Material, n, 'material');
    n.removeMaterial = ()=>{ n.material = defaultMaterial; mslot.textContent = "None (Default) - Drop Material"; }
    m.add(n, 'removeMaterial').name('Remove Material');

  } else if (State.selectedAsset) {
    const a = State.selectedAsset;
    gui.add(a, 'name').name('Asset Name').onFinishChange(renderAssets);
    if (a instanceof ModelData) {
      function updateModelGeometry() {
        a.generateBVH();
        for (var i = 0; i < State.nodes.length; i++) {
          if (State.nodes[i].model == a) State.nodes[i].updateGeo();
        }
      }
      a.centerOrigin = ()=>{a.renormalize(false);updateModelGeometry();}
      a.bottomOrigin = ()=>{a.renormalize(true);updateModelGeometry();}

      gui.add(a, 'centerOrigin').name('Center Origin');
      gui.add(a, 'bottomOrigin').name('Bottom Origin');

      a.rotX90deg = ()=>{a.bakeTransform(mat4.fromRotation(mat4.create(), Math.PI / 2, [1, 0, 0]));updateModelGeometry();}
      a.rotY90deg = ()=>{a.bakeTransform(mat4.fromRotation(mat4.create(), Math.PI / 2, [0, 1, 0]));updateModelGeometry();}
      a.rotZ90deg = ()=>{a.bakeTransform(mat4.fromRotation(mat4.create(), Math.PI / 2, [0, 0, 1]));updateModelGeometry();}
      
      gui.add(a, 'rotX90deg').name('Rotate X 90 degrees');
      gui.add(a, 'rotY90deg').name('Rotate Y 90 degrees');
      gui.add(a, 'rotZ90deg').name('Rotate Z 90 degrees');


      a.faceNormals = ()=>{a.calculateFaceNormals();updateModelGeometry();}
      a.smoothNormals = ()=>{a.calculateSmoothNormals();updateModelGeometry();}
      a.sphericalUVs = ()=>{a.calculateSphericalUVs();updateModelGeometry();}
      gui.add(a, 'faceNormals').name('Calculate Face Normals');
      gui.add(a, 'smoothNormals').name('Calculate Smooth Normals');
    }
    if (a instanceof Material) {
      gui.addColor(a, 'color').name('Albedo');
      gui.addColor(a, 'emittance').name('Emittance');
      gui.add(a, 'emissionIntensity').name('Emission Intensity');
      gui.add(a, 'roughness', 0, 1).name('Roughness');
      const t = gui.addFolder('Albedo Texture');
      var aslot = createAssetSlot(t, "Drop Texture Here", Texture, a, 'albedoTex');
      a.removeAlbedoTex = ()=>{ a.albedoTex = null; aslot.textContent = "Drop Texture Here"; }
      t.add(a, 'removeAlbedoTex').name('Remove Texture');
      const nt = gui.addFolder('Normal Texture');
      var nslot = createAssetSlot(nt, "Drop Texture Here", Texture, a, 'normalTex');
      a.removeNormalTex = ()=>{ a.normalTex = null; nslot.textContent = "Drop Texture Here"; }
      nt.add(a, 'removeNormalTex').name('Remove Texture');
    }
  }
};
const renderSceneInspector = () => {
  if (gui) gui.destroy(); 
  const root = document.getElementById('gui-root');
  
  // Fixed: Clear container to remove "Nothing selected" text
  root.innerHTML = ''; 

  gui = new GUI({ container: root, autoPlace: false });

  const a = State;
  const bg = gui.addFolder('Background');
  bg.addColor(a,'backgroundColor').name("Color");
  bg.add(a,'backgroundIntensity').name("Intensity");
  const bgt = gui.addFolder('Background Texture');
  var bslot = createAssetSlot(bgt, "Drop HDR Texture Here", HDRTexture, a, 'background');
  a.removeBackground = ()=>{ a.background = null; bslot.textContent = "Drop HDR Texture Here"; }
  bgt.add(a, 'removeBackground').name('Remove Texture');
}

// Canvas Drop for Models & Materials
canvas.ondragover = e => e.preventDefault();
canvas.ondrop = e => {
  const id = e.dataTransfer.getData('assetId');
  const asset = State.assets.find(a => a.id === id);
  if (asset && (asset instanceof ModelData || asset instanceof Material)) {
    if (asset instanceof ModelData) {
      // Drop Model: Create Model Node automatically
      const n = State.scene.newModel(defaultMaterial, asset); 
      State.nodes.push(n); selectNode(n.id);
    } else {
      // Drop Material: Find intersected Node
      const ray = MathUtils.getRay(e.clientX, e.clientY, canvas, Cam.proj, Cam.view);
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
  if (type === 'cube') {
    n = State.scene.newCube(defaultMaterial,-1,0,-1,1,2,1);
    n.name = "Cube " + State.idCounter;
  } else if (type === 'sphere') {
    n = State.scene.newSphere(defaultMaterial,0,1,0,1);
    n.name = "Sphere " + State.idCounter;
  } else if (type === 'cylinder') {
    n = State.scene.newFrustum(defaultMaterial).orient(0,0,0,1,0,2,0,1);
    n.name = "Cylinder " + State.idCounter;
  } else if (type === 'torus') {
    n = State.scene.newTorus(defaultMaterial,1,0.5).translate(0,1,0).scaleMult(2,2,2);
    n.name = "Torus " + State.idCounter;
  } else if (type === 'plane') {
    n = State.scene.newPlane(defaultMaterial,0,1,0,0);
    n.name = "Plane " + State.idCounter;
  }
  
  if (n) { State.nodes.push(n); selectNode(n.id); }
  e.target.value = ''; // Reset dropdown visually
};

window.createMaterial = () => {
  const mat = new Material("Material "+(State.assets.length+1),0,[1,1,1],0.5,[0,0,0]);
  State.assets.push(mat); renderAssets(); selectAsset(mat);
};
window.handleUpload = (input) => {
  const files = Array.from(input.files);
  
  files.forEach(async (file) => {
    var name = file.name.toLowerCase();
    const isOBJ = name.endsWith('.obj');
    const isImage = /\.(jpe?g|png|webp)$/i.test(name);
    const isHDR = name.endsWith('.hdr');

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
document.getElementById('ctx-delete').onclick = () => { 
  if (State.selected) State.nodes = State.nodes.filter(n => n.id !== State.selected.id); 
  if (State.selectedAsset) State.assets = State.assets.filter(n => n.id !== State.selectedAsset.id); 
  selectAsset(null);
  selectNode(null);
  ctxMenu.style.display='none';
};
window.onclick = () => ctxMenu.style.display='none';
window.onkeydown = e => { 
  if(e.key==='Delete'||e.key==='Backspace') document.getElementById('ctx-delete').click(); 
  if(e.key==='t' && !e.target.tagName.match(/INPUT/)) setTool('t'); 
  if(e.key==='r' && !e.target.tagName.match(/INPUT/)) setTool('r'); 
  if(e.key==='s' && !e.target.tagName.match(/INPUT/)) setTool('s');
  if(e.key==='b' && !e.target.tagName.match(/INPUT/)) renderSceneInspector();
};

const setTool = t => { State.tool=t; document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active', b.id==='tool-'+t)); };
['tool-t','tool-r','tool-s'].forEach(id => document.getElementById(id).onclick = () => setTool(id.split('-')[1]));

canvas.onmousedown = e => {
  const ray = MathUtils.getRay(e.clientX, e.clientY, canvas, Cam.proj, Cam.view), gizmo = Interact.testGizmo(ray);
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
  if (Interact.activeAxis) Interact.updateDrag(MathUtils.getRay(e.clientX, e.clientY, canvas, Cam.proj, Cam.view));
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
  }
};
window.onmouseup = () => { 
  Interact.activeAxis = null; 
  Cam.isOrbiting = Cam.isPanning=false;
};
canvas.onwheel = e => { 
  Cam.orbit.radius = Math.max(1, Cam.orbit.radius+e.deltaY*0.01); 
  e.preventDefault();
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
setupGutter('gutter-left','left-panel','x'); setupGutter('gutter-right','right-panel','x'); setupGutter('gutter-bottom','bottom-panel','y');

var renderActive = null;
function loop() { 
  if (renderActive) {
    renderActive();
  } else {
    Cam.update(canvas.width/canvas.height); 
    draw();
  }
  requestAnimationFrame(loop);
}

// Initial Setup
const initNode = State.scene.newCube(defaultMaterial,-1,0,-1,1,2,1); initNode.name = "Cube "+State.idCounter; State.nodes.push(initNode); selectNode(initNode.id);
createMaterial(); renderAssets(); loop();

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
  ui.count++;
}
var sceneLoaded = false;
async function startRender() {
  if (renderActive && sceneLoaded) {
    SaveRender('render-'+renderer.frame);
    return;
  }
  const canvas = document.getElementById('gpuCanvas');
  const status = document.getElementById('render-stats');
  sceneLoaded = false;
  status.innerText = 'Status: Loading Scene...';

  renderer = new Renderer(canvas);
  await renderer.init();
  
  //var scene = await SceneList[SelectedScene].create(canvas);
  var scene = State.scene;
  scene.objects = State.nodes;
  var col = State.backgroundColor;
  var mod = State.backgroundIntensity;
  if (!State.background) scene.background = new HDRTexture([col[0]*mod,col[1]*mod,col[2]*mod,1]);
  else scene.background = State.background;
  scene.bounces = Number(document.getElementById('render-bounces').value);

  scene.camera.position = Cam.position;
  scene.camera.target = Cam.target;
  scene.camera.updateRays();

  await renderer.setScene(scene);

  sceneLoaded = true;
  status.innerText = 'Status: Rendering...';

  const sppElement = document.getElementById('spp');
  renderActive = function() {
    renderer.render();
    sppElement.innerText = renderer.frame;
  }

  document.getElementById('btn-start-render').textContent = "SAVE RENDER";
}

function closeRenderPopup() {
  document.getElementById('render-modal').style.display='none';
  renderActive = null;
  document.getElementById('btn-start-render').textContent = "START RENDER";
}


// Logic to resize canvas when user changes inputs
document.getElementById('render-w').onchange = (e) => {
  if (renderActive) return;
  const canvas = document.getElementById('gpuCanvas');
  canvas.width = e.target.value;
  var cam = State.scene.camera;
  cam.aspect = canvas.width / canvas.height;
  cam.updateRays(); 
  if (renderer) renderer.frame = 0;
};
document.getElementById('render-h').onchange = (e) => {
  if (renderActive) return;
  const canvas = document.getElementById('gpuCanvas');
  canvas.height = e.target.value;
  var cam = State.scene.camera;
  cam.aspect = canvas.width / canvas.height;
  cam.updateRays(); 
  if (renderer) renderer.frame = 0;
};