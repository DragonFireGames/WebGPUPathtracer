//import { vec3, mat4, quat } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/+esm';
const { vec3, mat4, quat } = glMatrix;

// --- SCENE DEFINITION ---
class Texture {
  constructor(url) {
    this.url = url;
    this.image = new Image();
    this.image.crossOrigin = "anonymous";
    this.texIndex = -1;
    this.loaded = new Promise(resolve => {
      this.image.onload = () => resolve(this);
      this.image.onerror = () => { console.error("Failed to load:", url); resolve(this); };
      this.image.src = url;
    });
  }
}

class HDRTexture {
  constructor(url) {
    this.url = url;
    this.width = 1;
    this.height = 1;
    this.data = new Float16Array([0.02,0.03,0.05,1.0]); // Float16Array
    if (typeof url == 'string') this.loaded = this._load(url);
    else this.data = new Float16Array(url);
  }

  async _load(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const arrayBuffer = await response.arrayBuffer();
      // parse-hdr expects a Uint8Array
      const hdr = parseHdr(new Uint8Array(arrayBuffer));
      
      this.width = hdr.shape[0];
      this.height = hdr.shape[1];
      
      // Convert RGB (3 floats) to RGBA (4 floats) for WebGPU compatibility
      this.data = new Float16Array(this.width * this.height * 4);
      for (let i = 0; i < this.width * this.height; i++) {
        this.data[i * 4 + 0] = hdr.data[i * 4 + 0];
        this.data[i * 4 + 1] = hdr.data[i * 4 + 1];
        this.data[i * 4 + 2] = hdr.data[i * 4 + 2];
        this.data[i * 4 + 3] = 1.0; // Alpha channel
      }
      return this;
    } catch (err) {
      console.error("Failed to load HDR:", url, err);
      // Return a 1x1 black fallback so the engine doesn't crash
      this.width = 1; this.height = 1;
      this.data = new Float16Array([0.01, 0, 0, 1]);
      return this;
    }
  }
}

class Material {
  constructor(type, color, roughness, emittance, options = {}) {
    this.type = type;
    this.color = color;
    this.roughness = roughness;
    this.emittance = emittance;
    
    // Extended Texture Support
    this.albedoTex = options.albedoTex || null;
    this.normalTex = options.normalTex || null;
    this.heightTex = options.heightTex || null;
    this.roughnessTex = options.roughnessTex || null;
    
    this.uvScale = options.uvScale || [1, 1];
    this.normalMultiplier = options.normalMultiplier || 1;
    this.heightMultiplier = options.heightMultiplier !== undefined ? options.heightMultiplier : 0.05;
    this.heightSamp = options.heightSamp !== undefined ? options.heightSamp : 32;
    this.heightOffset = options.heightOffset || 0.0;
    this.ior = options.ior || 1.5;
    this.concentration = options.concentration || 1;
  }
}
Material.getSchema = function(m) {
  if (!m) m = {};
  let aIdx = m.albedoTex ? (m.albedoTex.texIndex !== undefined ? m.albedoTex.texIndex : -1) : -1;
  let nIdx = m.normalTex ? (m.normalTex.texIndex !== undefined ? m.normalTex.texIndex : -1) : -1;
  let hIdx = m.heightTex ? (m.heightTex.texIndex !== undefined ? m.heightTex.texIndex : -1) : -1;
  let rIdx = m.roughnessTex ? (m.roughnessTex.texIndex !== undefined ? m.roughnessTex.texIndex : -1) : -1;
  var ior = m.ior;
  if (m.type == 0) ior = ((ior-1)/(ior+1)) ** 2;
  return [
    {type: "vec3f", data: m.color},
    {type: "f32", data: m.roughness},
    {type: "vec3f", data: m.emittance},
    {type: "i32", data: m.type},
    {type: "i32", data: aIdx},
    {type: "i32", data: nIdx},
    {type: "i32", data: hIdx},
    {type: "i32", data: rIdx},
    {type: "vec2f", data: m.uvScale},
    {type: "f32", data: ior},
    {type: "f32", data: m.concentration},
    {type: "vec4f", data: [m.normalMultiplier, m.heightMultiplier, m.heightSamp, m.heightOffset]},
  ];
}

class Primitive {
  constructor(material) {
    this.material = material;
    this.position = vec3.create();
    this.scale = vec3.fromValues(1, 1, 1);
    this.rotation = quat.create(); 
    this.matrix = mat4.create();
    this.invMatrix = mat4.create();
  }
  translate(x, y, z) {
    vec3.add(this.position, this.position, [x, y, z]);
    this.updateMatrix();
    return this; // Allows chaining: p.translate(1,0,0).scale(2,2,2)
  }

  scaleMult(x, y, z) {
    vec3.multiply(this.scale, this.scale, [x, y, z]);
    this.updateMatrix();
    return this; 
  }

  scaleSet(x, y, z) {
    // If only one argument is provided, scale uniformly
    if (y === undefined) y = z = x;
    vec3.set(this.scale, x, y, z);
    this.updateMatrix();
    return this;
  }

  // Rotates around the X axis (theta in radians)
  rotateX(theta) {
    quat.rotateX(this.rotation, this.rotation, theta);
    this.updateMatrix();
    return this;
  }

  // Rotates around the Y axis
  rotateY(theta) {
    quat.rotateY(this.rotation, this.rotation, theta);
    this.updateMatrix();
    return this;
  }

  // Rotates around the Z axis
  rotateZ(theta) {
    quat.rotateZ(this.rotation, this.rotation, theta);
    this.updateMatrix();
    return this;
  }

  // Rotate by theta around an arbitrary axis [ax, ay, az]
  rotate(theta, ax, ay, az) {
    const axis = vec3.fromValues(ax, ay, az);
    vec3.normalize(axis, axis);
    quat.setAxisAngle(this.rotation, axis, theta);
    this.updateMatrix();
    return this;
  }

  // Handy helper to set position directly
  setPosition(x, y, z) {
    vec3.set(this.position, x, y, z);
    this.updateMatrix();
    return this;
  }

  // Matrix
  updateMatrix() {
    mat4.fromRotationTranslationScale(this.matrix, this.rotation, this.position, this.scale);
    mat4.invert(this.invMatrix, this.matrix);
  }

  getWorldAABB() {
    const worldMatrix = mat4.create();
    mat4.invert(worldMatrix, this.invMatrix);
    // Unit sphere is -1 to 1 in local space
    return transformAABB([-1,-1,-1], [1,1,1], worldMatrix);
  }
}

// Helper to transform an AABB by a matrix
function transformAABB(localMin, localMax, worldMatrix) {
  const corners = [];
  for (let x of [localMin[0], localMax[0]]) {
    for (let y of [localMin[1], localMax[1]]) {
      for (let z of [localMin[2], localMax[2]]) {
        const p = vec3.fromValues(x, y, z);
        vec3.transformMat4(p, p, worldMatrix);
        corners.push(p);
      }
    }
  }
  const min = vec3.fromValues(Infinity, Infinity, Infinity);
  const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  for (let c of corners) {
    vec3.min(min, min, c);
    vec3.max(max, max, c);
  }
  return { min, max };
}

class Sphere extends Primitive {
  constructor(material, x, y, z, radius) {
    super(material);
    this.type = "Sphere";
    vec3.set(this.position, x, y, z);
    vec3.set(this.scale, radius, radius, radius);
    this.updateMatrix();
  }
}
Sphere.getSchema = function(sphere) {
  if (!sphere) sphere = {material:{_index:-1}};
  return [
    { type:"mat4x4f", data: sphere.invMatrix },
    { type:"i32", data: sphere.material._index },
    { type:"i32", data: 1 },
  ];
}

class Cube extends Primitive {
  constructor(material, minX, minY, minZ, maxX, maxY, maxZ) {
    super(material);
    this.type = "Cube";
    vec3.set(this.position, (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    vec3.set(this.scale, (maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    this.updateMatrix();
  }
}
Cube.getSchema = function(cube) {
  if (!cube) cube = {material:{_index:-1}};
  return [
    { type:"mat4x4f", data: cube.invMatrix },
    { type:"i32", data: cube.material._index },
    { type:"i32", data: 2 },
  ];
}

class Frustum extends Primitive {
  constructor(material, top_radius = 0.5) {
    super(material);
    this.type = "Frustum";
    this.top_radius = top_radius; // In this context, it will act as a ratio
  }

  orient(x1, y1, z1, r1, x2, y2, z2, r2) {
    const p1 = vec3.fromValues(x1, y1, z1);
    const p2 = vec3.fromValues(x2, y2, z2);
    const dir = vec3.create();

    // 1. Determine which end is the "Base" (y=0)
    // We want the wider end to be the base so top_radius is always <= 1.0
    if (r1 >= r2) {
      vec3.set(this.position, x1, y1, z1); // Start at P1
      vec3.subtract(dir, p2, p1);          // Point toward P2
      const h = vec3.length(dir);
      vec3.set(this.scale, r1, h, r1);     // Width is r1, height is distance
      this.top_radius = (r1 > 0) ? r2 / r1 : 0;
    } else {
      vec3.set(this.position, x2, y2, z2); // Start at P2
      vec3.subtract(dir, p1, p2);          // Point toward P1
      const h = vec3.length(dir);
      vec3.set(this.scale, r2, h, r2);     // Width is r2, height is distance
      this.top_radius = (r2 > 0) ? r1 / r2 : 0;
    }

    // 2. Align Local Y (0,1,0) to the segment direction
    const dist = vec3.length(dir);
    if (dist > 1e-6) {
      vec3.normalize(dir, dir);
      quat.rotationTo(this.rotation, [0, 1, 0], dir);
    } else {
      quat.identity(this.rotation);
    }

    this.updateMatrix();
    return this;
  }

  getWorldAABB() {
    const worldMatrix = mat4.create();
    mat4.invert(worldMatrix, this.invMatrix);
    // Frustum is defined y=0 to y=1, and x/z depends on radii
    const maxR = Math.max(this.bottomRadius, this.topRadius);
    return transformAABB([-maxR, 0, -maxR], [maxR, 1, maxR], worldMatrix);
  }
}
Frustum.getSchema = function(frustum) {
  if (!frustum) frustum = {material:{_index:-1}};
  return [
    { type: "mat4x4f", data: frustum.invMatrix },
    { type: "i32", data: frustum.material._index },
    { type: "i32", data: 3 },
    { type: "f32", data: frustum.top_radius },
  ];
}

class Torus extends Primitive {
  constructor(material, outerRadius = 1.0, innerRadius = 0.3) {
    super(material);
    this.type = "Torus";
    this.setRadii(outerRadius, innerRadius);
  }

  setRadii(outer, inner) {
    // We fix the local Outer Radius (R) to 1.0
    // So we scale the entire object by 'outer'
    this.scaleSet(outer, outer, outer);
    
    // The inner radius (r) must be stored as a ratio relative to the outer radius
    this.inner_radius = inner / outer; 
    return this;
  }

  getWorldAABB() {
    const worldMatrix = mat4.create();
    mat4.invert(worldMatrix, this.invMatrix);
    // Torus lies in XZ plane. Local bounds:
    const r = this.majorRadius + this.minorRadius;
    return transformAABB([-r, -this.minorRadius, -r], [r, this.minorRadius, r], worldMatrix);
  }
}
Torus.getSchema = function(torus) {
  if (!torus) torus = {material:{_index:-1}, inner_radius: 0};
  return [
    { type: "mat4x4f", data: torus.invMatrix },
    { type: "i32", data: torus.material._index },
    { type: "i32", data: 4 },
    { type: "f32", data: torus.inner_radius },
  ];
}

class Plane {
  constructor(material, nx, ny, nz, d) {
    this.material = material;
    this.normal = vec3.normalize(vec3.create(), vec3.fromValues(nx, ny, nz));
    this.d = d;
    this.type = "Plane";
  }
}
Plane.getSchema = function(plane) {
  if (!plane) plane = {material:{_index:-1}};
  return [
    { type:"vec3f", data: plane.normal },
    { type:"f32", data: plane.d },
    { type:"i32", data: plane.material._index },
  ];
}

class AABB {
  constructor() {
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }
  expand(p) {
    this.min[0] = Math.min(this.min[0], p[0]); this.min[1] = Math.min(this.min[1], p[1]); this.min[2] = Math.min(this.min[2], p[2]);
    this.max[0] = Math.max(this.max[0], p[0]); this.max[1] = Math.max(this.max[1], p[1]); this.max[2] = Math.max(this.max[2], p[2]);
  }
  expandAABB(aabb) {
    if (aabb.min[0] === Infinity) return;
    this.expand(aabb.min);
    this.expand(aabb.max);
  }
  area() {
    let e = [this.max[0]-this.min[0], this.max[1]-this.min[1], this.max[2]-this.min[2]];
    if (e[0] < 0 || e[1] < 0 || e[2] < 0) return 0;
    return 2 * (e[0]*e[1] + e[1]*e[2] + e[2]*e[0]);
  }
}

class ModelData {
  constructor(url, onload) {
    this.triangles = []; // Initial raw triangles
    this.nodes = [];     // Final flattened BVH nodes [{min, max, num_triangles, next}]
    this.flatTriangles = []; // Final sorted triangles [{v0, v1, v2, n0, n1, n2, u0, u1, u2}]
    this.triangles = [];

    this.loaded = (async () => {
      try {
        const res = await fetch(url);
        const txt = await res.text();
        this.parseOBJ(txt);
        if (onload) onload(this);
      } catch (e) {
        console.error("Model load failed:", e);
      }
    })();
  }

  parseOBJ(txt) {
    const lines = txt.split('\n');
    const v = [], vt = [], vn = [];
    this.triangles = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v') v.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      else if (parts[0] === 'vt') vt.push([parseFloat(parts[1]), parseFloat(parts[2])]);
      else if (parts[0] === 'vn') vn.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      else if (parts[0] === 'f') {
        const face = parts.slice(1).map(p => {
          const indices = p.split('/');
          return {
            v: parseInt(indices[0]) - 1,
            vt: indices[1] ? parseInt(indices[1]) - 1 : -1,
            vn: indices[2] ? parseInt(indices[2]) - 1 : -1
          };
        });
        for (let i = 1; i < face.length - 1; i++) {
          const tri = {
            v0: [...v[face[0].v]], v1: [...v[face[i].v]], v2: [...v[face[i+1].v]],
            u0: face[0].vt >= 0 ? [...vt[face[0].vt]] : [0,0],
            u1: face[i].vt >= 0 ? [...vt[face[i].vt]] : [0,0],
            u2: face[i+1].vt >= 0 ? [...vt[face[i+1].vt]] : [0,0],
            n0: face[0].vn >= 0 ? [...vn[face[0].vn]] : [0,1,0],
            n1: face[i].vn >= 0 ? [...vn[face[i].vn]] : [0,1,0],
            n2: face[i+1].vn >= 0 ? [...vn[face[i+1].vn]] : [0,1,0],
          };
          tri.centroid = [(tri.v0[0]+tri.v1[0]+tri.v2[0])/3, (tri.v0[1]+tri.v1[1]+tri.v2[1])/3, (tri.v0[2]+tri.v1[2]+tri.v2[2])/3];
          this.triangles.push(tri);
        }
      }
    }
  }

  generateBVH() {
    const triCentroids = this.triangles.map(t => t.centroid);
    const triIndices = this.triangles.map((_, i) => i);

    const getBounds = (indices) => {
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const idx of indices) {
        const t = this.triangles[idx];
        const verts = [t.v0, t.v1, t.v2];
        for (const v of verts) {
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], v[k]);
            max[k] = Math.max(max[k], v[k]);
          }
        }
      }
      return { min, max };
    };

    const getArea = (min, max) => {
      const d = [max[0]-min[0], max[1]-min[1], max[2]-min[2]];
      return 2 * (d[0]*d[1] + d[1]*d[2] + d[2]*d[0]);
    };

    const subdivide = (indices) => {
      const { min, max } = getBounds(indices);
      const rootArea = getArea(min, max);
      let bestCost = indices.length * rootArea;
      let bestAxis = -1, bestSplit = -1;

      // SAH Evaluation
      for (let axis = 0; axis < 3; axis++) {
        const start = min[axis], end = max[axis];
        if (end - start < 1e-6) continue;

        const numBins = Math.min(indices.length, 12);
        for (let i = 1; i < numBins; i++) {
          const split = start + (i / numBins) * (end - start);
          let left = [], right = [];
          for (const idx of indices) {
            if (triCentroids[idx][axis] < split) left.push(idx); else right.push(idx);
          }
          if (left.length === 0 || right.length === 0) continue;
          
          const bL = getBounds(left), bR = getBounds(right);
          const cost = left.length * getArea(bL.min, bL.max) + right.length * getArea(bR.min, bR.max);
          if (cost < bestCost) {
            bestCost = cost; bestAxis = axis; bestSplit = split;
          }
        }
      }

      if (bestAxis === -1 || indices.length <= 2) {
        return { min, max, indices };
      }

      let leftIndices = [], rightIndices = [];
      for (const idx of indices) {
        if (triCentroids[idx][bestAxis] < bestSplit) leftIndices.push(idx); else rightIndices.push(idx);
      }

      return {
        min, max,
        left: subdivide(leftIndices),
        right: subdivide(rightIndices)
      };
    };

    const bvhRoot = subdivide(triIndices);
    this.nodes = [];
    this.flatTriangles = [];

    const flatten = (node,parent) => {
      const index = this.nodes.length;
      const flatNode = { min: node.min, max: node.max, num_triangles: 0, next: 0, parent: parent };
      this.nodes.push(flatNode);

      if (node.indices) {
        flatNode.num_triangles = node.indices.length;
        flatNode.next = this.flatTriangles.length; // tri_start
        for (const idx of node.indices) {
          this.flatTriangles.push(this.triangles[idx]);
        }
      } else {
        flatten(node.left,index);
        flatNode.next = flatten(node.right,index); // index of right child
      }
      return index;
    };

    flatten(bvhRoot,-1);
  }

  bakeTransform(matrix) {
    for (let t of this.triangles) {
      vec3.transformMat4(t.v0, t.v0, matrix);
      vec3.transformMat4(t.v1, t.v1, matrix);
      vec3.transformMat4(t.v2, t.v2, matrix);
      t.centroid = [ (t.v0[0]+t.v1[0]+t.v2[0])/3, (t.v0[1]+t.v1[1]+t.v2[1])/3, (t.v0[2]+t.v1[2]+t.v2[2])/3 ];
    }
  }

  renormalize(bottom) {
    let aabb = new AABB();
    for (let t of this.triangles) {
      aabb.expand(t.v0); aabb.expand(t.v1); aabb.expand(t.v2);
    }
    let center = [ (aabb.min[0]+aabb.max[0])/2, (aabb.min[1]+aabb.max[1])/2, (aabb.min[2]+aabb.max[2])/2 ];
    let size = Math.max(aabb.max[0]-aabb.min[0], aabb.max[1]-aabb.min[1], aabb.max[2]-aabb.min[2]);
    let scale = 2.0 / size;
    let m = mat4.create();
    if (bottom) center[1] = 0;
    mat4.scale(m, m, [scale, scale, scale]);
    mat4.translate(m, m, [-center[0], -center[1], -center[2]]);
    this.bakeTransform(m);
  }

  calculateVertexNormals() {
    for (let t of this.triangles) {
      let e1 = vec3.sub([], t.v1, t.v0);
      let e2 = vec3.sub([], t.v2, t.v0);
      let n = vec3.cross([], e1, e2);
      vec3.normalize(n, n);
      t.n0 = [...n]; t.n1 = [...n]; t.n2 = [...n];
    }
  }

  calculateSmoothNormals(weightByArea = true) {
    // 1. Map to accumulate normals for each unique vertex position
    // Key: "x,y,z" string, Value: [nx, ny, nz]
    const vertexNormalMap = new Map();

    // 2. First pass: Calculate face normals and accumulate
    for (let tri of this.triangles) {
      // Edge vectors
      const e1 = [tri.v1[0] - tri.v0[0], tri.v1[1] - tri.v0[1], tri.v1[2] - tri.v0[2]];
      const e2 = [tri.v2[0] - tri.v0[0], tri.v2[1] - tri.v0[1], tri.v2[2] - tri.v0[2]];
      
      // Cross product (Face Normal * 2 * Area)
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      
      let faceNormal = [nx, ny, nz];
      const crossProductMag = Math.sqrt(nx * nx + ny * ny + nz * nz);

      if (crossProductMag > 1e-10) {
        if (weightByArea) {
          // The magnitude of the cross product is already proportional to 2 * Area.
          // Keeping the vector as-is automatically weights the sum by triangle size.
          faceNormal = [nx, ny, nz]; 
        } else {
          // Normalizing here gives every triangle 1.0 "vote" regardless of size.
          faceNormal = [nx / crossProductMag, ny / crossProductMag, nz / crossProductMag];
        }

        // Accumulate for all 3 vertices
        [tri.v0, tri.v1, tri.v2].forEach(v => {
          const key = `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
          if (!vertexNormalMap.has(key)) {
            vertexNormalMap.set(key, [0, 0, 0]);
          }
          const n = vertexNormalMap.get(key);
          n[0] += faceNormal[0];
          n[1] += faceNormal[1];
          n[2] += faceNormal[2];
        });
      }
    }

    // 3. Second pass: Normalize and assign
    for (let tri of this.triangles) {
      [tri.v0, tri.v1, tri.v2].forEach((v, i) => {
        const key = `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
        const n = vertexNormalMap.get(key);
        
        const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
        const finalN = len > 1e-10 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 1, 0];

        tri[`n${i}`] = finalN;
      });
    }
  }

  calculateSphericalUVs() {
    for (let t of this.triangles) {
      t.uv0 = [ Math.atan2(t.v0[2], t.v0[0])/(2*Math.PI)+0.5, Math.asin(t.v0[1])/Math.PI+0.5 ];
      t.uv1 = [ Math.atan2(t.v1[2], t.v1[0])/(2*Math.PI)+0.5, Math.asin(t.v1[1])/Math.PI+0.5 ];
      t.uv2 = [ Math.atan2(t.v2[2], t.v2[0])/(2*Math.PI)+0.5, Math.asin(t.v2[1])/Math.PI+0.5 ];
    }
  }
}

class Model extends Primitive {
  constructor(material, model) {
    super(material);
    this.model = model;
    this.type = "Model";
  }
  getWorldAABB() {
    // Meshes already have a local BVH. We take the root node's AABB.
    const root = this.model.nodes[0];
    const worldMatrix = mat4.create();
    mat4.invert(worldMatrix, this.invMatrix);
    return transformAABB(root.min, root.max, worldMatrix);
  }
}
Model.getSchema = function(mesh) {
  if (!mesh) mesh = { material: { _index:-1 }, model: { _node_offset: 0, _tri_offset: 0 } };
  return [
    { type: "mat4x4f", data: mesh.invMatrix },
    { type: "i32", data: mesh.material._index },
    { type: "u32", data: mesh.model._node_offset },
    { type: "u32", data: mesh.model._tri_offset },
  ];
}

class SceneBVHBuilder {
  constructor(objects) {
    this.objects = objects;
    this.nodes = [];
    this.build();
  }

  build() {
    if (this.objects.length === 0) return;

    // Create an array of object references with their calculated world bounds
    const items = this.objects.map((obj, index) => ({
      index: index, // This is the index in the globalObjectBuffer
      aabb: obj.getWorldAABB()
    }));

    this.recursiveBuild(items, 0);
  }

  recursiveBuild(items, depth) {
    const nodeIdx = this.nodes.length;
    
    // Initialize node with dummy data
    const node = {
      min: [0, 0, 0],
      max: [0, 0, 0],
      num_objects: 0,
      object_index: -1,
      next: -1
    };
    this.nodes.push(node);

    // Calculate Bounds for this node
    const bounds = this.calcBounds(items);
    node.min = bounds.min;
    node.max = bounds.max;

    // Leaf Node: Only 1 object left or max depth reached
    if (items.length <= 1 || depth > 20) {
      node.num_objects = items.length;
      node.object_index = items[0].index; // The pointer to globalObjectBuffer
      return;
    }

    // Split logic: Find the widest axis
    const size = vec3.sub(vec3.create(), bounds.max, bounds.min);
    let axis = 0;
    if (size[1] > size[0]) axis = 1;
    if (size[2] > size[axis]) axis = 2;

    // Sort items by the center of their AABB on the chosen axis
    items.sort((a, b) => {
      const centerA = (a.aabb.min[axis] + a.aabb.max[axis]) * 0.5;
      const centerB = (b.aabb.min[axis] + b.aabb.max[axis]) * 0.5;
      return centerA - centerB;
    });

    const mid = Math.floor(items.length / 2);
    
    // Left child is always current_index + 1
    this.recursiveBuild(items.slice(0, mid), depth + 1);
    
    // Right child index needs to be stored in 'next'
    node.next = this.nodes.length;
    this.recursiveBuild(items.slice(mid), depth + 1);
  }

  calcBounds(items) {
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    for (const item of items) {
      vec3.min(min, min, item.aabb.min);
      vec3.max(max, max, item.aabb.max);
    }
    return { min, max };
  }

  flatten() {
    // Each node is 8 floats (32 bytes):
    // [min.x, min.y, min.z, num_objects]
    // [max.x, max.y, max.z, next_node_index/object_index]
    const data = new Float32Array(this.nodes.length * 8);
    const view = new DataView(data.buffer);

    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const base = i * 8;
      
      data[base + 0] = n.min[0];
      data[base + 1] = n.min[1];
      data[base + 2] = n.min[2];
      // num_objects is stored as a bitcast uint32 in the 4th float slot
      view.setUint32((base + 3) * 4, n.num_objects, true);

      data[base + 4] = n.max[0];
      data[base + 5] = n.max[1];
      data[base + 6] = n.max[2];
      
      // If leaf, store object index. If branch, store index of right child.
      const ptr = (n.num_objects > 0) ? n.object_index : n.next;
      view.setUint32((base + 7) * 4, ptr, true);
    }
    return data;
  }
}

class Scene {
  constructor(canvas) {
    this.objects = [];
    this.camera = new Camera(canvas);
    this.bounces = 8;
    this.background = null;
  }
  newSphere() { var o = new Sphere(...arguments); this.objects.push(o); return o; }
  newCube() { var o = new Cube(...arguments); this.objects.push(o); return o; }
  newPlane() { var o = new Plane(...arguments); this.objects.push(o); return o; }
  newFrustum() { var o = new Frustum(...arguments); this.objects.push(o); return o; }
  newTorus() { var o = new Torus(...arguments); this.objects.push(o); return o; }
  newModel() { var o = new Model(...arguments); this.objects.push(o); return o; }
  getMaterials() {
    var list = this.objects;
    var mats = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i].material || list[i];
      if (m && !mats.includes(m)) mats.push(m);
    }
    return mats;
  }
  getTextures() {
    var mats = this.getMaterials();
    var texs = [];
    for (var i = 0; i < mats.length; i++) {
      [mats[i].albedoTex, mats[i].normalTex, mats[i].heightTex, mats[i].roughnessTex].forEach(t => {
        if (t && !texs.includes(t)) texs.push(t);
      });
    }
    return texs;
  }
}

class Camera {
  constructor(canvas) {
    this.position = vec3.fromValues(0, 1.5, 4.5);
    this.lookingat = vec3.fromValues(0, 0.5, 0);
    this.fov = 45; 
    this.aspect = canvas.width / canvas.height;
    this.ray00 = vec3.create(); this.ray10 = vec3.create();
    this.ray01 = vec3.create(); this.ray11 = vec3.create();
    this.updateRays();
  }
  updateRays() {
    const f = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), this.lookingat, this.position));
    const r = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), f, [0, 1, 0]));
    const u = vec3.cross(vec3.create(), r, f);
    const h = Math.tan((this.fov * Math.PI / 180) / 2); 
    const w = h * this.aspect;
    const hr = vec3.scale(vec3.create(), r, w); 
    const hu = vec3.scale(vec3.create(), u, h);
    vec3.sub(this.ray00, f, hr); vec3.sub(this.ray00, this.ray00, hu);
    vec3.add(this.ray10, f, hr); vec3.sub(this.ray10, this.ray10, hu);
    vec3.sub(this.ray01, f, hr); vec3.add(this.ray01, this.ray01, hu);
    vec3.add(this.ray11, f, hr); vec3.add(this.ray11, this.ray11, hu);
  }
  lookAt(x,y,z) {
    this.lookingat = vec3.fromValues(x,y,z);
    this.updateRays();
  }
  setPosition(x,y,z) {
    this.position = vec3.fromValues(x,y,z);
    this.updateRays();
  }
}

async function loadText(url) {
  var res = await fetch(url,{});
  return await res.text();
}

// --- RENDERER ---
class Renderer {
  constructor(canvas) {
    if (!navigator.gpu) return alert("WebGPU not supported.");
    this.canvas = canvas;
    this.context = canvas.getContext("webgpu");
    this.scene = null;
    this.frame = 0;
  }
  
  async init() {
    const { context } = this;
    const adapter = await navigator.gpu.requestAdapter();
    const maxBuffers = adapter.limits.maxStorageBuffersPerShaderStage;
    const maxSize = adapter.limits.maxStorageBufferBindingSize;
    console.log(`Your GPU supports up to ${maxBuffers} storage buffers.`);
    console.log(`Your GPU supports up to ${maxSize} binding size.`);
    this.device = await adapter.requestDevice({
      requiredLimits: {
        // Request the maximum the hardware allows
        maxStorageBuffersPerShaderStage: maxBuffers,
        // You might also want to bump this for your accumulation buffer
        maxStorageBufferBindingSize: maxSize,
      }
    });
    context.configure({ 
      device: this.device, 
      format: 'rgba8unorm', 
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST 
    });
  }

  packDataFromSchema(objects, getSchema) {
    // 1. Get a sample schema to calculate stride
    // We use a prototype instance if the array is empty
    const sampleObj = objects.length > 0 ? objects[0] : false;
    const schema = getSchema(sampleObj);
    
    let bytesPerObject = 0;
    const sizes = { vec2f: 8, vec3f: 12, vec4f: 16, f32: 4, i32: 4, u32: 4, mat2x2f: 16, mat3x3f: 36, mat4x4f: 64 };
    schema.forEach(item => {
      bytesPerObject += sizes[item.type];
    });

    // 2. Align to 16 bytes (WGSL Requirement)
    const remainder = bytesPerObject % 16;
    if (remainder !== 0) bytesPerObject += (16 - remainder);
    const strideFloats = bytesPerObject / 4;

    // 3. Handle Empty Arrays: Create 1 dummy object if count is 0
    const count = Math.max(1, objects.length);
    const data = new Float32Array(count * strideFloats);
    const view = new DataView(data.buffer);

    // 4. If we actually have objects, fill them
    if (objects.length <= 0) return { data: data, size: bytesPerObject };
    objects.forEach((obj, objIdx) => {
      const baseByte = objIdx * bytesPerObject;
      let offset = 0;
      getSchema(obj).forEach(item => {
        const addr = baseByte + offset;
        if (!item.padding) {
          if (item.type === "vec2f" || item.type === "vec3f" || item.type == "vec4f" || item.type === "mat2x2f" || item.type === "mat3x3f" || item.type === "mat4x4f") {
            data.set(item.data, addr / 4);
          } else if (item.type === "f32") {
            view.setFloat32(addr, item.data, true);
          } else if (item.type === "i32") {
            view.setInt32(addr, item.data, true);
          } else if (item.type === "u32") {
            view.setUint32(addr, item.data, true);
          }
        }
        // Increment offset based on type
        offset += item.padding ? 4 : sizes[item.type];
      });
    });

    return { data: data, size: bytesPerObject };
  }

  async setScene(scene) {
    this.scene = scene;
    const { canvas, device } = this;

    // --- 0. PREPARE TEXTURES (Up to 8 Supported) ---
    const textures = scene.getTextures();
    const gpuTextures = [];
    const dummyTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: dummyTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);

    for (let i = 0; i < 8; i++) {
      if (i < textures.length && textures[i].image.complete && textures[i].image.naturalWidth > 0) {
        const img = textures[i].image;
        const bitmap = await createImageBitmap(img);
        const tex = device.createTexture({
          size: [img.width, img.height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [img.width, img.height]);
        gpuTextures.push(tex);
        textures[i].texIndex = i; 
      } else {
        gpuTextures.push(dummyTex); 
      }
    }
    
    const sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat' // Required for POM tiling
    });

    // --- NEW: PREPARE HDRI SKYBOX ---
    let hdrTextureView;
    const skybox = scene.background; // Assuming you have this in your scene object
    const hasSkybox = skybox instanceof HDRTexture;
    if (hasSkybox) {
      const skyTex = device.createTexture({ 
        size: [ skybox.width, skybox.height ],
        format: 'rgba16float', 
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });

      device.queue.writeTexture(
        { texture: skyTex },
        skybox.data,
        { bytesPerRow: skybox.width * 8 },
        [ skybox.width, skybox.height ]
      );

      hdrTextureView = skyTex.createView();
    } else {
      // Fallback to a dark blue dummy sky if no URL provided
      const dummySky = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: dummySky }, new Float16Array([0.02, 0.03, 0.05, 1.0]), { bytesPerRow: 8 }, [1, 1]);
      hdrTextureView = dummySky.createView();
      // const dummyTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      // device.queue.writeTexture({ texture: dummyTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
      // hdrTextureView = dummyTex.createView();
    }
    const skySampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // --- 1. EXTRACT & PACK MATERIALS ---
    const mats = scene.getMaterials();
    var hasHeightMaps = false;
    mats.forEach((m, i) => {
      m._index = i;
      if (m.heightTex) hasHeightMaps = true;
    });
    const { data: matData, size: matSize } = this.packDataFromSchema(mats,Material.getSchema);

    const hasSpheres = scene.objects.some(o => o.type === "Sphere");
    const hasCubes = scene.objects.some(o => o.type === "Cube");
    const hasFrustums = scene.objects.some(o => o.type === "Frustum");
    const hasTori = scene.objects.some(o => o.type === "Torus");
    const bvh = new SceneBVHBuilder(scene.objects.filter(o => ["Sphere","Cube","Frustum","Torus"].includes(o.type)));
    const { data: objectData, size: objectSize } = this.packDataFromSchema(bvh.objects,(obj)=>{
      if (!obj) obj = new Sphere({_index:-1},0,0,0,1);
      return obj.constructor.getSchema(obj);
    });
    const tlasData = bvh.flatten();

    const planes = scene.objects.filter(o => o.type === "Plane");
    const hasPlanes = planes.length > 0;
    const { data: planeData, size: planeSize } = this.packDataFromSchema(planes,Plane.getSchema);
    
    const makeBuf = (data, minSize = 16) => {
      const size = Math.max(minSize, data.byteLength);
      const b = this.device.createBuffer({ 
        size: size, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      if (data.byteLength > 0) this.device.queue.writeBuffer(b, 0, data);
      return b;
    };

    // --- 1. PRE-CALCULATE TOTALS ---
    const modelObjects = scene.objects.filter(o => o.type === "Model");
    const hasMeshes = modelObjects.length > 0;
        
    // Get a list of unique ModelData instances
    const uniqueModels = [];
    modelObjects.forEach(obj => {
      if (!uniqueModels.includes(obj.model)) {
        uniqueModels.push(obj.model);
      }
    });

    let totalNodes = 0;
    let totalTriangles = 0;

    uniqueModels.forEach(m => {
      m._node_offset = totalNodes;
      m._tri_offset = totalTriangles;
      totalNodes += m.nodes.length;
      totalTriangles += m.flatTriangles.length;
    });

    // --- 2. ALLOCATE BUFFERS ---
    const bvhData = new Float32Array(Math.max(1, totalNodes) * 8);
    const bvhView = new DataView(bvhData.buffer);

    const triData = new Float32Array(Math.max(1, totalTriangles) * 32);

    // --- 3. FILL SHARED DATA (BVH & Triangles) ---
    uniqueModels.forEach(m => {
      // Pack BVH Nodes for this model
      m.nodes.forEach((node, nIdx) => {
        const nBase = (m._node_offset + nIdx) * 8;
        bvhData.set(node.min, nBase);
        bvhView.setUint32((nBase + 3) * 4, node.num_triangles, true);
        bvhData.set(node.max, nBase + 4);
        bvhView.setUint32((nBase + 7) * 4, node.next, true);
      });

      // Pack Triangles for this model
      m.flatTriangles.forEach((tri, tIdx) => {
        const tBase = (m._tri_offset + tIdx) * 32;
        triData.set([...tri.v0, 0], tBase + 0);
        triData.set([...tri.v1, 0], tBase + 4);
        triData.set([...tri.v2, 0], tBase + 8);
        triData.set([...tri.n0, 0], tBase + 12);
        triData.set([...tri.n1, 0], tBase + 16);
        triData.set([...tri.n2, 0], tBase + 20);
        triData.set([...tri.u0, ...tri.u1, ...tri.u2], tBase + 24);
      });
    });

    // --- 4. FILL MESH INSTANCES ---
    const { data: meshData, size: meshSize } = this.packDataFromSchema(modelObjects,Model.getSchema);

    // --- 5. CREATE THE BUFFERS ---
    const meshBuffer = makeBuf(meshData, meshSize);
    const bvhBuffer = makeBuf(bvhData, 32);
    const triangleBuffer = makeBuf(triData, 128);
    const matBuffer = makeBuf(matData, matSize);
    const objectBuffer = makeBuf(objectData, objectSize);
    const tlasBuffer = makeBuf(tlasData, 32);
    const planeBuffer = makeBuf(planeData, planeSize);

    const uBuf = this.uBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const aBuf = device.createBuffer({ size: canvas.width * canvas.height * 16, usage: GPUBufferUsage.STORAGE });

    const wgslCode = await loadText('shader.wgsl');
    const shaderModule = device.createShaderModule({ code: wgslCode });

    const info = await shaderModule.getCompilationInfo();
    if (info.messages.length > 0) {
      console.error("WGSL Compilation Failed:");
      for (const m of info.messages) {
        const line = m.lineNum;
        const col = m.linePos;
        console.warn(`Line ${line}:${col} - ${m.message}`);
      }
    }

    const pipe = this.pipe = device.createComputePipeline({ 
      layout: 'auto', 
      compute: { 
        module: shaderModule, 
        entryPoint: 'main',
        constants: { 
          0: scene.bounces, 
          1: hasSpheres ? 1 : 0, 
          2: hasCubes ? 1 : 0, 
          3: hasPlanes ? 1 : 0, 
          4: hasFrustums ? 1 : 0, 
          5: hasTori ? 1 : 0, 
          6: hasMeshes ? 1 : 0, 
          7: hasHeightMaps ? 1 : 0,
          8: hasSkybox ? 1 : 0,
        }
      } 
    });
    
    const tex = this.tex = device.createTexture({ 
      size: [canvas.width, canvas.height], 
      format: 'rgba8unorm', 
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC 
    });

    this.bG = device.createBindGroup({ 
      layout: pipe.getBindGroupLayout(0), 
      entries: [
        { binding: 0, resource: { buffer: uBuf } }, 
        { binding: 1, resource: { buffer: aBuf } },
        { binding: 2, resource: tex.createView() }, 
        { binding: 3, resource: { buffer: matBuffer } },
        { binding: 4, resource: { buffer: objectBuffer } }, 
        { binding: 5, resource: { buffer: tlasBuffer } },
        { binding: 6, resource: { buffer: meshBuffer } },
        { binding: 7, resource: { buffer: bvhBuffer } },
        { binding: 8, resource: { buffer: triangleBuffer } },
        { binding: 9, resource: { buffer: planeBuffer } },
        // Expanded Texture Bindings
        ...gpuTextures.map((t, i) => ({ binding: 10 + i, resource: t.createView() })),
        { binding: 18, resource: sampler },
        //
        { binding: 19, resource: hdrTextureView },
        { binding: 20, resource: skySampler }
      ]
    });

    this.frame = 0;
  }
  
  render() {
    if (!this.scene) return;
    const { canvas, context, device, bG, pipe, tex, uBuf } = this;
    const cam = this.scene.camera;
    
    const uData = new Float32Array(24);
    new Uint32Array(uData.buffer).set([this.frame, canvas.width, canvas.height, 0]);
    uData.set([...cam.position, 0], 4); 
    uData.set([...cam.ray00, 0], 8); 
    uData.set([...cam.ray10, 0], 12);
    uData.set([...cam.ray01, 0], 16); 
    uData.set([...cam.ray11, 0], 20);
    device.queue.writeBuffer(uBuf, 0, uData);
    
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); 
    pass.setBindGroup(0, bG);
    pass.dispatchWorkgroups(Math.ceil(canvas.width / 16), Math.ceil(canvas.height / 16));
    pass.end();
    
    enc.copyTextureToTexture({ texture: tex }, { texture: context.getCurrentTexture() }, [canvas.width, canvas.height]);
    device.queue.submit([enc.finish()]);
    
    this.frame++;
  }
}

