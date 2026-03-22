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

class Cube extends Primitive {
  constructor(material, minX, minY, minZ, maxX, maxY, maxZ) {
    super(material);
    this.type = "Cube";
    vec3.set(this.position, (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    vec3.set(this.scale, (maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    this.updateMatrix();
  }
}

class Plane {
  constructor(material, nx, ny, nz, d) {
    this.material = material;
    this.normal = vec3.normalize(vec3.create(), vec3.fromValues(nx, ny, nz));
    this.d = d;
    this.type = "Plane";
  }
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

    const flatten = (node) => {
      const index = this.nodes.length;
      const flatNode = { min: node.min, max: node.max, num_triangles: 0, next: 0 };
      this.nodes.push(flatNode);

      if (node.indices) {
        flatNode.num_triangles = node.indices.length;
        flatNode.next = this.flatTriangles.length; // tri_start
        for (const idx of node.indices) {
          this.flatTriangles.push(this.triangles[idx]);
        }
      } else {
        flatten(node.left);
        flatNode.next = flatten(node.right); // index of right child
      }
      return index;
    };

    flatten(bvhRoot);
  }

  bakeTransform(matrix) {
    for (let t of this.triangles) {
      vec3.transformMat4(t.v0, t.v0, matrix);
      vec3.transformMat4(t.v1, t.v1, matrix);
      vec3.transformMat4(t.v2, t.v2, matrix);
      t.centroid = [ (t.v0[0]+t.v1[0]+t.v2[0])/3, (t.v0[1]+t.v1[1]+t.v2[1])/3, (t.v0[2]+t.v1[2]+t.v2[2])/3 ];
    }
  }

  renormalize() {
    let aabb = new AABB();
    for (let t of this.triangles) {
      aabb.expand(t.v0); aabb.expand(t.v1); aabb.expand(t.v2);
    }
    let center = [ (aabb.min[0]+aabb.max[0])/2, (aabb.min[1]+aabb.max[1])/2, (aabb.min[2]+aabb.max[2])/2 ];
    let size = Math.max(aabb.max[0]-aabb.min[0], aabb.max[1]-aabb.min[1], aabb.max[2]-aabb.min[2]);
    let scale = 2.0 / size;
    let m = mat4.create();
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
  getNodes() {
    return this.model.nodes;
    return [ {min: [-1,-1,-1], max:[1,1,1], num_triangles: 2, next: 0} ];
  }
  getTriangles() {
    return this.model.flatTriangles;
    return [ {
      v0:[0,0,0], v1:[1,0,0], v2:[0,1,0], 
      n0:[0,0,1], n1:[0,0,1], n2:[0,0,1], 
      u0:[0,0], u1:[1,0], u2:[0,1] 
     }, {
      v0:[1,1,0], v1:[1,0,0], v2:[0,1,0], 
      n0:[0,0,1], n1:[0,0,1], n2:[0,0,1], 
      u0:[0,0], u1:[1,0], u2:[0,1] 
     } ];
  }
  //getMinCorner() { return this.model.getMinCorner(); }
  //getMaxCorner() { return this.model.getMaxCorner(); }
}

class Scene {
  constructor(canvas) {
    this.objects = [];
    this.camera = new Camera(canvas);
    this.bounces = 8;
    this.background = null;
  }
  newSphere() { var o = new Sphere(...arguments); this.objects.push(o); return o; }
  newPlane() { var o = new Plane(...arguments); this.objects.push(o); return o; }
  newCube() { var o = new Cube(...arguments); this.objects.push(o); return o; }
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

var SelectedScene = 0;
var SceneList = [
  {
    name: "POM & Normals Box",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 1024;
      canvas.height = 768;

      var scene = new Scene(canvas);

      var cam = scene.camera;
      //cam.lookAt(0,0.5,0);
      //cam.setPosition(0,0,4.5);
      
      // Preload our new textures
      var woodTex = new Texture('https://i.ibb.co/0RnQ8mp0/wood.png');
      var normalTex = new Texture('https://i.ibb.co/dJzqsKry/normal.png');
      var dispTex = new Texture('https://i.ibb.co/0ywvFnyh/disp.png');

      var bunnyModel = new ModelData('assets/bunny/model.obj');
      var bunnyColor = new Texture('assets/bunny/color.jpg');
      var bunnyNormal = new Texture('assets/bunny/normal.png');

      //scene.background = new HDRTexture([0.8,0.85,1,1]);
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_greenhouse_2k.hdr');
      //scene.background = new HDRTexture('assets/cape_hill_4k.hdr');

      await Promise.all([
        woodTex.loaded, 
        normalTex.loaded, 
        dispTex.loaded, 
        bunnyModel.loaded,
        bunnyColor.loaded,
        bunnyNormal.loaded,
        //scene.background.loaded
      ]);
      bunnyModel.renormalize();
      //rook.calculateVertexNormals();
      //rook.calculateSphericalUVs();
      bunnyModel.generateBVH();
      //console.log(rook)

      var matWhite = new Material(0,[0.8, 0.8, 0.8], 1.0, [0, 0, 0]);
      var matRed = new Material(0,[0.8, 0.2, 0.2], 1.0, [0, 0, 0]);
      var matGreen = new Material(0,[0.2, 0.8, 0.2], 1.0, [0, 0, 0]);
      var matCeramic = new Material(0,[0.9, 0.9, 0.9], 0.0, [0, 0, 0]);
      var matMetal = new Material(1,[0.8, 0.9, 0.8], 0.0, [0, 0, 0]);
      var matLight = new Material(0,[0.0, 0.0, 0.0], 1.0, [15, 15, 15]);
      
      // Set up the robust POM material!
      var toyBox = new Material(0,[1.0, 1.0, 1.0], 0.5, [0, 0, 0], {
        albedoTex: woodTex,
        normalTex: normalTex,
        heightTex: dispTex,
        uvScale: [1.0, 1.0], // Scale of the texture on the plane
        normalMultiplier: 1,
        heightMultiplier: 0.15, // Positive means Depth Map (white=deep). Negative means Height Map (white=high).
        heightSamp: 32,      // Number of raymarch steps
        heightOffset: 0    // Shifts where the surface starts
      });

      var matGlass = new Material(2,[1.0, 1.0, 1.0], 0.0, [0, 0, 0]);
      var matBlueGlass = new Material(2,[0.2, 0.2, 1.0], 1.0, [0, 0, 0]);
      var matRedGlass = new Material(2,[1.0, 0.2, 0.2], 0.0, [0, 0, 0]);
      var matUraniumGlass = new Material(2,[0.4, 1.0, 0.4], 0.0, [0, 0.01, 0]);

      scene.newPlane(matCeramic, 0, 1, 0, 0);    // Floor (POM Textured)
      scene.newPlane(matWhite, 0, -1, 0, -3.5);   // Ceiling
      scene.newPlane(matMetal, 0, 0, 1, -3.0);    // Back wall
      scene.newPlane(matMetal, 0, 0, -1, -10.0);    // Front wall
      scene.newPlane(matRed, 1, 0, 0, -2.5);      // Left wall
      scene.newPlane(matGreen, -1, 0, 0, -2.5);   // Right wall
      
      scene.newSphere(matLight, 0, 3.5, 0, 0.5);
      //scene.newSphere(matBlueGlass, -1.6, 0.5, -1.4, 0.5);
      //scene.newSphere(matGlass, 0, 0, 0, 2);

      var bunnyMaterial = new Material(0,[1.0, 1.0, 1.0], 0.5, [0, 0, 0], {
        albedoTex: bunnyColor,
        normalTex: bunnyNormal,
        uvScale: [1.0, -1.0],
      });
      var model = scene.newModel(matBlueGlass,bunnyModel);
      model.translate(0,1,0);

      var model2 = scene.newModel(matRedGlass,bunnyModel);
      model2.scaleMult(0.5,0.5,0.5);
      model2.translate(-1,0.5,1);

      //let box = scene.newCube(toyBox, 0.2, 0.4, -0.2, 1.0, 1.2, 0.6);
      //quat.setAxisAngle(box.rotation, [0, 1, 0], -20 * Math.PI / 180); 
      //box.updateMatrix();

      scene.bounces = 24;

      return scene;
    }
  }
];

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
    this.device = await adapter.requestDevice();
    context.configure({ 
      device: this.device, 
      format: 'rgba8unorm', 
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST 
    });
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
    // 20 floats = 80 bytes per material 
    const matData = new Float32Array(Math.max(1, mats.length) * 20); 
    const matView = new DataView(matData.buffer);
    var hasHeightMaps = false;
    mats.forEach((m, i) => {
      m._index = i;
      const base = i * 20; // Float index
      const byteBase = base * 4; // Byte offset

      m._index = i;
      let aIdx = m.albedoTex ? (m.albedoTex.texIndex !== undefined ? m.albedoTex.texIndex : -1) : -1;
      let nIdx = m.normalTex ? (m.normalTex.texIndex !== undefined ? m.normalTex.texIndex : -1) : -1;
      let hIdx = m.heightTex ? (m.heightTex.texIndex !== undefined ? m.heightTex.texIndex : -1) : -1;
      let rIdx = m.roughnessTex ? (m.roughnessTex.texIndex !== undefined ? m.roughnessTex.texIndex : -1) : -1;
      if (m.heightTex) hasHeightMaps = true;

      // Bulk set Albedo and Emittance (Indices 0-7)
      matData.set([...m.color, m.roughness], base);
      matData.set(m.emittance, base + 4); 
      matView.setInt32(byteBase + 28, m.type, true); // material_type at byte 28

      // Set Integer Texture IDs (Indices 8-11)
      matView.setInt32(byteBase + 32, aIdx, true);
      matView.setInt32(byteBase + 36, nIdx, true);
      matView.setInt32(byteBase + 40, hIdx, true);
      matView.setInt32(byteBase + 44, rIdx, true);

      // Bulk set UV Scale and Height Params (Indices 12-13 and 16-19)
      matData.set(m.uvScale, base + 12);
      var ior = m.ior;
      if (m.type == 0) ior = ((ior-1)/(ior+1)) ** 2;
      matView.setFloat32(byteBase + 56, ior, true); // ior (Float index 14)
      matView.setFloat32(byteBase + 60, m.concentration, true); // ior (Float index 15)
      matData.set([m.normalMultiplier, m.heightMultiplier, m.heightSamp, m.heightOffset], base + 16);
    });

    const spheres = scene.objects.filter(o => o.type === "Sphere");
    const hasSpheres = spheres.length > 0;
    const sphereData = new Float32Array(Math.max(1, spheres.length) * 20);
    const sphereView = new DataView(sphereData.buffer);
    spheres.forEach((s, i) => {
      const base = i * 20;
      sphereData.set(s.invMatrix, base); 
      sphereView.setInt32((base + 16) * 4, s.material._index, true); 
    });

    const cubes = scene.objects.filter(o => o.type === "Cube");
    const hasCubes = cubes.length > 0;
    const cubeData = new Float32Array(Math.max(1, cubes.length) * 20);
    const cubeView = new DataView(cubeData.buffer); 
    cubes.forEach((c, i) => {
      const base = i * 20;
      cubeData.set(c.invMatrix, base);
      cubeView.setInt32((base + 16) * 4, c.material._index, true); 
    });

    const planes = scene.objects.filter(o => o.type === "Plane");
    const hasPlanes = planes.length > 0;
    const planeData = new Float32Array(Math.max(1, planes.length) * 8);
    const planeView = new DataView(planeData.buffer);
    planes.forEach((p, i) => {
      const base = i * 8;
      planeData.set([...p.normal, p.d], base);
      planeView.setInt32((base + 4) * 4, p.material._index, true);
    });
    
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

    // Map each unique model to its starting offset in the global buffers
    const modelOffsets = new Map();

    uniqueModels.forEach(m => {
      modelOffsets.set(m, {
        nodeOffset: totalNodes,
        triOffset: totalTriangles
      });
      totalNodes += m.nodes.length;
      totalTriangles += m.flatTriangles.length;
    });

    // --- 2. ALLOCATE BUFFERS ---
    const meshData = new Float32Array(Math.max(1, modelObjects.length) * 20);
    const meshView = new DataView(meshData.buffer);

    const bvhData = new Float32Array(Math.max(1, totalNodes) * 8);
    const bvhView = new DataView(bvhData.buffer);

    const triData = new Float32Array(Math.max(1, totalTriangles) * 32);

    // --- 3. FILL SHARED DATA (BVH & Triangles) ---
    uniqueModels.forEach(m => {
      const { nodeOffset, triOffset } = modelOffsets.get(m);

      // Pack BVH Nodes for this model
      m.nodes.forEach((node, nIdx) => {
        const nBase = (nodeOffset + nIdx) * 8;
        bvhData.set(node.min, nBase);
        bvhView.setUint32((nBase + 3) * 4, node.num_triangles, true);
        bvhData.set(node.max, nBase + 4);
        bvhView.setUint32((nBase + 7) * 4, node.next, true);
      });

      // Pack Triangles for this model
      m.flatTriangles.forEach((tri, tIdx) => {
        const tBase = (triOffset + tIdx) * 32;
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
    modelObjects.forEach((obj, i) => {
      const mBase = i * 20;
      const offsets = modelOffsets.get(obj.model);
      
      // Every MeshInstance gets its own transform and material
      meshData.set(obj.invMatrix, mBase);
      
      // But multiple MeshInstances can point to the same nodeOffset and triOffset
      meshView.setUint32((mBase + 16) * 4, offsets.nodeOffset, true);
      meshView.setUint32((mBase + 17) * 4, offsets.triOffset, true);
      meshView.setInt32((mBase + 18) * 4, obj.material._index, true);
    });

    // --- 5. CREATE THE BUFFERS ---
    const meshBuffer = makeBuf(meshData, 80);
    const bvhBuffer = makeBuf(bvhData, 32);
    const triangleBuffer = makeBuf(triData, 128);
    const matBuffer = makeBuf(matData, 80);
    const sphereBuffer = makeBuf(sphereData);
    const planeBuffer = makeBuf(planeData);
    const cubeBuffer = makeBuf(cubeData);

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
          2: hasPlanes ? 1 : 0, 
          3: hasCubes ? 1 : 0, 
          4: hasMeshes ? 1 : 0, 
          5: hasHeightMaps ? 1 : 0,
          6: hasSkybox ? 1 : 0,
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
        { binding: 4, resource: { buffer: meshBuffer } },
        { binding: 5, resource: { buffer: bvhBuffer } },
        { binding: 6, resource: { buffer: triangleBuffer } },
        // Primitives
        { binding: 7, resource: { buffer: sphereBuffer } }, 
        { binding: 8, resource: { buffer: planeBuffer } },
        { binding: 9, resource: { buffer: cubeBuffer } },
        // Expanded Texture Bindings
        { binding: 10, resource: gpuTextures[0].createView() },
        { binding: 11, resource: gpuTextures[1].createView() },
        { binding: 12, resource: gpuTextures[2].createView() },
        { binding: 13, resource: gpuTextures[3].createView() },
        { binding: 14, resource: gpuTextures[4].createView() },
        { binding: 15, resource: gpuTextures[5].createView() },
        { binding: 16, resource: gpuTextures[6].createView() },
        { binding: 17, resource: gpuTextures[7].createView() },
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

// --- MAIN ---
var renderer;
async function init() {
  const canvas = document.getElementById("gpuCanvas");
  //canvas.width = window.innerWidth;
  //canvas.height = window.innerHeight;

  await SceneList[SelectedScene].load();
  
  renderer = new Renderer(canvas);
  await renderer.init();
  
  var scene = await SceneList[SelectedScene].create(canvas);
  await renderer.setScene(scene);

  var cam = scene.camera;
  let angleX = 0, angleY = 0, zoom = 4.5; 
  
  function updateCamera() {
    vec3.set(cam.position, 
      zoom * Math.cos(angleX) * Math.sin(angleY), 
      zoom * Math.sin(angleX) + 1.0,
      zoom * Math.cos(angleX) * Math.cos(angleY)
    );
    cam.updateRays(); 
    renderer.frame = 0; 
  }
  updateCamera();

  window.onmousemove = (e) => { 
    if (e.buttons === 1) { 
      angleY -= e.movementX * 0.005; 
      angleX = Math.max(-1.5, Math.min(1.5, angleX + e.movementY * 0.005));
      updateCamera();
    }
  };
  window.onwheel = (e) => {
    zoom = Math.max(1.0, zoom + e.deltaY * 0.01); 
    updateCamera();
  };
  
  const sppElement = document.getElementById('spp');
  const blElement = document.getElementById('bl');
  blElement.innerText = renderer.scene.bounces;
  function render() {
    renderer.render();
    sppElement.innerText = renderer.frame;
    requestAnimationFrame(render);
  }
  render();
}

init();
