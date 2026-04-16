class GLTFLoader {
  constructor() {
    this.textureCache = new Map();
    this.assetMap = new Map();
    this.basePath = "";
  }

  async loadFromAssets(json, assetMap = new Map(), basePath = "") {
    this.assetMap = assetMap;
    this.basePath = basePath;
    return this.parse(json, null);
  }

  resolveUri(uri) {
    if (!uri) return null;
    if (uri.startsWith('data:')) return uri;
    if (this.assetMap.has(uri)) return this.assetMap.get(uri);
    const relativePath = this.basePath + uri;
    if (this.assetMap.has(relativePath)) return this.assetMap.get(relativePath);
    return uri;
  }

  async loadGLB(url, assetMap = new Map(), basePath = "") {
    this.assetMap = assetMap;
    this.basePath = basePath;

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const dataView = new DataView(arrayBuffer);
    
    if (dataView.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB");

    const jsonLen = dataView.getUint32(12, true);
    const jsonContent = new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLen));
    const json = JSON.parse(jsonContent);

    const binOffset = 20 + jsonLen + 8;
    const binaryData = arrayBuffer.slice(binOffset);

    return this.parse(json, binaryData);
  }

  async parse(json, internalBinary) {
    const materials = (json.materials || []).map(m => this.createMaterial(m, json, internalBinary));
    const worldMatrices = this.computeAllWorldMatrices(json);

    const meshToSplits = new Map();
    const allSplitModels = [];

    // 1. Process geometries and forcefully split disconnected components
    for (let nodeIdx = 0; nodeIdx < json.nodes.length; nodeIdx++) {
      const node = json.nodes[nodeIdx];
      if (node.mesh === undefined) continue;
      
      // NEW: Skip processing preview geometry for our known analytic primitives!
      if (node.extras && node.extras.ptracer_primitive) continue;

      if (!meshToSplits.has(node.mesh)) {
        const splits = await this.processMesh(json.meshes[node.mesh], json, internalBinary);
        meshToSplits.set(node.mesh, splits);
        allSplitModels.push(...splits);
      }
    }

    // 2. Deterministic Y-Locked Deduplication
    const dedupeMap = this.deduplicateModels(allSplitModels);

    // 3. Build Model Instances using extracted local transforms
    const instances = [];
    for (let nodeIdx = 0; nodeIdx < json.nodes.length; nodeIdx++) {
      const node = json.nodes[nodeIdx];
      if (node.mesh === undefined) continue;

      // NEW: Intercept Primitives and bypass the standard Mesh pipeline
      if (node.extras && node.extras.ptracer_primitive) {
        let mat = new Material("Default");
        // Extract the material that was tied to the dummy preview geometry
        if (node.mesh !== undefined && json.meshes[node.mesh] && json.meshes[node.mesh].primitives.length > 0) {
          const prim = json.meshes[node.mesh].primitives[0];
          if (prim.material !== undefined) mat = materials[prim.material];
        }

        const type = node.extras.ptracer_primitive;
        const name = node.name || `${type}_${nodeIdx}`;
        let modelInstance;
        
        // Safely instantiate the actual mathematical raytraced shape
        if (type === "Sphere") modelInstance = new Sphere(name, mat);
        else if (type === "Cube") modelInstance = new Cube(name, mat);
        else if (type === "Plane") modelInstance = new Plane(name, mat);
        else if (type === "Cylinder") modelInstance = new Cylinder(name, mat, node.extras.top_radius);
        else if (type === "Torus") modelInstance = new Torus(name, mat, 1, node.extras.inner_radius);

        if (modelInstance) {
          const finalWorld = worldMatrices[nodeIdx];
          if (mat4.invert(modelInstance.invMatrix, finalWorld)) {
            if (!modelInstance.position) modelInstance.position = vec3.create();
            if (!modelInstance.rotation) modelInstance.rotation = quat.create();
            if (!modelInstance.scale) modelInstance.scale = vec3.create();

            mat4.getTranslation(modelInstance.position, finalWorld);
            mat4.getRotation(modelInstance.rotation, finalWorld);
            mat4.getScaling(modelInstance.scale, finalWorld);
          } else {
            mat4.identity(modelInstance.invMatrix);
          }
          instances.push(modelInstance);
        }

        node.object = modelInstance;
        continue;
      }

      // STANDARD MESH PROCESSING
      const splits = meshToSplits.get(node.mesh);
      if (!splits) continue;
      splits.forEach((modelData, splitIdx) => {
        const dedupeInfo = dedupeMap.get(modelData);
        const baseModelData = dedupeInfo.base;
        const T_inv = dedupeInfo.T_inv; 

        const primIdx = modelData.sourcePrimIdx;
        const primitive = json.meshes[node.mesh].primitives[primIdx];
        const mat = primitive.material !== undefined ? materials[primitive.material] : new Material("Default");
        
        const modelInstance = new Model(`${node.name || 'Node'}_m${node.mesh}_p${primIdx}_s${splitIdx}`, mat, baseModelData);

        const finalWorld = mat4.create();
        mat4.multiply(finalWorld, worldMatrices[nodeIdx], T_inv);

        if (mat4.invert(modelInstance.invMatrix, finalWorld)) {
          if (!modelInstance.position) modelInstance.position = vec3.create();
          if (!modelInstance.rotation) modelInstance.rotation = quat.create();
          if (!modelInstance.scale) modelInstance.scale = vec3.create();

          mat4.getTranslation(modelInstance.position, finalWorld);
          mat4.getRotation(modelInstance.rotation, finalWorld);
          mat4.getScaling(modelInstance.scale, finalWorld);
        } else {
          mat4.identity(modelInstance.invMatrix);
        }

        node.object = modelInstance;
        instances.push(modelInstance);
      });
    }

    // 4. Normalize the resulting final scene
    if (json.asset.generator != "PathTracer GLB Exporter") this.normalizeScene(instances);

    const assets = this.collectAssets(instances, materials);
    for (const t of assets.texs) await t.loaded;

    return { nodes: instances, ...assets };
  }

  splitDisconnected(model) {
    // Standard spatial hash based splitting for polygon soup
    const numFaces = model.index_positions.length / 3;
    if (numFaces === 0 || numFaces > 200000) return [model]; 

    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const pos = model.vertex_positions;
    for(let i=0; i<pos.length; i+=3) {
        min[0]=Math.min(min[0], pos[i]); max[0]=Math.max(max[0], pos[i]);
        min[1]=Math.min(min[1], pos[i+1]); max[1]=Math.max(max[1], pos[i+1]);
        min[2]=Math.min(min[2], pos[i+2]); max[2]=Math.max(max[2], pos[i+2]);
    }
    const maxDim = Math.max(max[0]-min[0], max[1]-min[1], max[2]-min[2], 1e-4);
    
    const hashTol = maxDim * 0.005; 
    const getHash = (x, y, z) => `${Math.round(x / hashTol)}_${Math.round(y / hashTol)}_${Math.round(z / hashTol)}`;

    const idx = model.index_positions;
    const spatialHash = new Map();

    for (let f = 0; f < numFaces; f++) {
      for (let j = 0; j < 3; j++) {
        const vi = idx[f * 3 + j];
        const hash = getHash(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
        if (!spatialHash.has(hash)) spatialHash.set(hash, []);
        spatialHash.get(hash).push(f);
      }
    }

    const visited = new Uint8Array(numFaces);
    const initialComponents = [];

    for (let f = 0; f < numFaces; f++) {
      if (visited[f]) continue;

      const comp = [];
      const queue = [f];
      visited[f] = 1;

      while (queue.length > 0) {
        const curr = queue.shift();
        comp.push(curr);

        for (let j = 0; j < 3; j++) {
          const vi = idx[curr * 3 + j];
          const hash = getHash(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
          const neighbors = spatialHash.get(hash);
          for (let n = 0; n < neighbors.length; n++) {
            const nFace = neighbors[n];
            if (!visited[nFace]) {
              visited[nFace] = 1;
              queue.push(nFace);
            }
          }
        }
      }
      initialComponents.push(comp);
    }
    
    if (initialComponents.length === 1 || initialComponents.length > 200) return [model];

    const comps = initialComponents.map(faces => {
      let cMin = [Infinity, Infinity, Infinity], cMax = [-Infinity, -Infinity, -Infinity];
      for (let f of faces) {
        for(let j=0; j<3; j++) {
          let vi = idx[f * 3 + j];
          let vx = pos[vi * 3], vy = pos[vi * 3 + 1], vz = pos[vi * 3 + 2];
          if(vx < cMin[0]) cMin[0] = vx; if(vx > cMax[0]) cMax[0] = vx;
          if(vy < cMin[1]) cMin[1] = vy; if(vy > cMax[1]) cMax[1] = vy;
          if(vz < cMin[2]) cMin[2] = vz; if(vz > cMax[2]) cMax[2] = vz;
        }
      }
      return { faces, aabb: {min: cMin, max: cMax} };
    });

    const margin = maxDim * 0.05; 
    const aabbIntersect = (a, b) => {
      return (a.min[0] <= b.max[0]+margin && a.max[0] >= b.min[0]-margin) &&
             (a.min[1] <= b.max[1]+margin && a.max[1] >= b.min[1]-margin) &&
             (a.min[2] <= b.max[2]+margin && a.max[2] >= b.min[2]-margin);
    };

    let merged = true;
    while(merged) {
      merged = false;
      for(let i=0; i<comps.length; i++) {
        for(let j=i+1; j<comps.length; j++) {
          if (aabbIntersect(comps[i].aabb, comps[j].aabb)) {
            comps[i].faces.push(...comps[j].faces);
            comps[i].aabb.min = [Math.min(comps[i].aabb.min[0], comps[j].aabb.min[0]), Math.min(comps[i].aabb.min[1], comps[j].aabb.min[1]), Math.min(comps[i].aabb.min[2], comps[j].aabb.min[2])];
            comps[i].aabb.max = [Math.max(comps[i].aabb.max[0], comps[j].aabb.max[0]), Math.max(comps[i].aabb.max[1], comps[j].aabb.max[1]), Math.max(comps[i].aabb.max[2], comps[j].aabb.max[2])];
            comps.splice(j, 1);
            merged = true; break;
          }
        }
        if(merged) break;
      }
    }

    if (comps.length === 1) return [model]; 

    const splits = [];
    for (let c = 0; c < comps.length; c++) {
      const comp = comps[c].faces;
      const newModel = new ModelData(`${model.name}_part${c}`);
      newModel.sourcePrimIdx = model.sourcePrimIdx; 

      const oldToNew = new Map();
      const newPos = [], newNorm = [], newUV = [], newIdx = [];

      for (let i = 0; i < comp.length; i++) {
        const f = comp[i];
        for (let j = 0; j < 3; j++) {
          const vi = idx[f * 3 + j];
          if (!oldToNew.has(vi)) {
            oldToNew.set(vi, newPos.length / 3);
            newPos.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
            if (model.vertex_normals) {
              newNorm.push(model.vertex_normals[vi * 3], model.vertex_normals[vi * 3 + 1], model.vertex_normals[vi * 3 + 2]);
            }
            if (model.vertex_texcoords) {
              newUV.push(model.vertex_texcoords[vi * 2], model.vertex_texcoords[vi * 2 + 1]);
            }
          }
          newIdx.push(oldToNew.get(vi));
        }
      }

      newModel.vertex_positions = new Float32Array(newPos);
      if (newNorm.length) newModel.vertex_normals = new Float32Array(newNorm);
      if (newUV.length) newModel.vertex_texcoords = new Float32Array(newUV);
      newModel.index_positions = new Uint32Array(newIdx);
      newModel.index_normals = newModel.index_positions;
      newModel.index_texcoords = newModel.index_positions;

      splits.push(newModel);
    }
    return splits;
  }

  buildSpatialHash(model, tolerance) {
    model.spatialHash = new Map();
    const pos = model.vertex_positions;
    const invTol = 1.0 / tolerance;
    for (let i=0; i<pos.length; i+=3) {
      const cx = Math.round(pos[i]*invTol);
      const cy = Math.round(pos[i+1]*invTol);
      const cz = Math.round(pos[i+2]*invTol);
      const hash = `${cx}_${cy}_${cz}`;
      if (!model.spatialHash.has(hash)) model.spatialHash.set(hash, []);
      model.spatialHash.get(hash).push([pos[i], pos[i+1], pos[i+2]]);
    }
  }

  canonicalizeBase(model) {
    const pos = model.vertex_positions;
    const n = pos.length / 3;
    if (n === 0) {
      model.invCanonicalMatrix = mat4.create();
      return;
    }

    // 1. Calculate precise AABB
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i=0; i<n; i++) {
      let x = pos[i*3], y = pos[i*3+1], z = pos[i*3+2];
      min[0]=Math.min(min[0], x); max[0]=Math.max(max[0], x);
      min[1]=Math.min(min[1], y); max[1]=Math.max(max[1], y);
      min[2]=Math.min(min[2], z); max[2]=Math.max(max[2], z);
    }

    const cx = (min[0] + max[0]) / 2;
    const cy = min[1]; // Pin to the bottom of the geometry (Y-Up lock)
    const cz = (min[2] + max[2]) / 2;
    
    model.dimensions = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const maxDim = Math.max(model.dimensions[0], model.dimensions[1], model.dimensions[2], 1e-4);
    const scale = 1.0 / maxDim;

    // Transform: Translate AABB center to origin, scale to Unit Box
    // NO ROTATION APPLIED. Upright orientation is permanently locked.
    const canonMat = mat4.create();
    mat4.scale(canonMat, canonMat, [scale, scale, scale]);
    mat4.translate(canonMat, canonMat, [-cx, -cy, -cz]);

    const invCanon = mat4.create();
    mat4.invert(invCanon, canonMat);

    const normMat = mat4.create();
    mat4.invert(normMat, canonMat);
    mat4.transpose(normMat, normMat);

    model.canonicalMin = [Infinity, Infinity, Infinity];
    model.canonicalMax = [-Infinity, -Infinity, -Infinity];

    for (let i=0; i<n; i++) {
       let v = vec3.fromValues(pos[i*3], pos[i*3+1], pos[i*3+2]);
       vec3.transformMat4(v, v, canonMat);
       pos[i*3] = v[0]; pos[i*3+1] = v[1]; pos[i*3+2] = v[2];

       model.canonicalMin[0] = Math.min(model.canonicalMin[0], v[0]);
       model.canonicalMax[0] = Math.max(model.canonicalMax[0], v[0]);
       model.canonicalMin[1] = Math.min(model.canonicalMin[1], v[1]);
       model.canonicalMax[1] = Math.max(model.canonicalMax[1], v[1]);
       model.canonicalMin[2] = Math.min(model.canonicalMin[2], v[2]);
       model.canonicalMax[2] = Math.max(model.canonicalMax[2], v[2]);

       if (model.vertex_normals && model.vertex_normals.length > i*3+2) {
           let vn = vec3.fromValues(model.vertex_normals[i*3], model.vertex_normals[i*3+1], model.vertex_normals[i*3+2]);
           let vnw = vec4.fromValues(vn[0], vn[1], vn[2], 0.0);
           vec4.transformMat4(vnw, vnw, normMat);
           vec3.set(vn, vnw[0], vnw[1], vnw[2]);
           vec3.normalize(vn, vn);
           model.vertex_normals[i*3] = vn[0];
           model.vertex_normals[i*3+1] = vn[1];
           model.vertex_normals[i*3+2] = vn[2];
       }
    }

    model.invCanonicalMatrix = invCanon;
  }

  deduplicateModels(models) {
    const dedupeMap = new Map();
    const bases = [];
    
    // The 4 acceptable Y-Axis Rotations (0, 90, 180, 270 degrees)
    const yRotations = [
      mat4.fromValues(1,0,0,0,  0,1,0,0,  0,0,1,0,  0,0,0,1),   // 0 deg
      mat4.fromValues(0,0,-1,0, 0,1,0,0,  1,0,0,0,  0,0,0,1),   // 90 deg
      mat4.fromValues(-1,0,0,0, 0,1,0,0,  0,0,-1,0, 0,0,0,1),   // 180 deg
      mat4.fromValues(0,0,1,0,  0,1,0,0, -1,0,0,0,  0,0,0,1)    // 270 deg
    ];

    for (let i = 0; i < models.length; i++) {
      const cand = models[i];
      this.canonicalizeBase(cand);

      let matched = false;

      for (let b = 0; b < bases.length; b++) {
        const base = bases[b];
        
        // Strict Gate 1: Vertex/Index counts must be roughly similar (15% tolerance for shimmers)
        const vDiff = Math.abs(base.vertex_positions.length - cand.vertex_positions.length) / base.vertex_positions.length;
        if (vDiff > 0.15) continue;

        // Strict Gate 2: AABB Dimensions must match within 3%
        const bd = base.dimensions;
        const cd = cand.dimensions;
        const dimTol = 0.03 * Math.max(bd[0], bd[1], bd[2]);
        
        const yMatch = Math.abs(bd[1] - cd[1]) <= dimTol;
        const xzMatch0 = Math.abs(bd[0] - cd[0]) <= dimTol && Math.abs(bd[2] - cd[2]) <= dimTol; // 0 or 180 deg
        const xzMatch90 = Math.abs(bd[0] - cd[2]) <= dimTol && Math.abs(bd[2] - cd[0]) <= dimTol; // 90 or 270 deg

        if (!yMatch || (!xzMatch0 && !xzMatch90)) continue;

        // Test the 4 specific Y-rotations
        for (let rIdx = 0; rIdx < yRotations.length; rIdx++) {
           const R = yRotations[rIdx];
           
           // If AABB says 0/180 but matrix is 90/270, skip
           if (xzMatch0 && !xzMatch90 && (rIdx === 1 || rIdx === 3)) continue;
           if (xzMatch90 && !xzMatch0 && (rIdx === 0 || rIdx === 2)) continue;

           // Tolerance of 0.04 (4% of the unit box size) to account for float "shimmers"
           if (this.testTransform(base, cand, R, 0.04)) {
              const R_inv = mat4.create();
              mat4.invert(R_inv, R);

              const inst_invCanon = mat4.create();
              mat4.multiply(inst_invCanon, cand.invCanonicalMatrix, R_inv);
              dedupeMap.set(cand, { base: base, T_inv: inst_invCanon });
              matched = true; break;
           }
        }
        if (matched) break;
      }

      if (!matched) {
        // Cache spatial hash for this new base object
        this.buildSpatialHash(cand, 0.04);
        dedupeMap.set(cand, { base: cand, T_inv: cand.invCanonicalMatrix });
        cand.generateBVH();
        bases.push(cand);
      }
    }

    return dedupeMap;
  }

  testTransform(base, cand, transform, tolerance) {
    const cPos = cand.vertex_positions;
    
    // Winding-Order Agnostic Test
    // Using up to 600 vertices distributed across the mesh
    const testCount = Math.min(600, cPos.length / 3);
    const step = Math.max(1, Math.floor((cPos.length / 3) / testCount));
    
    let matchCount = 0;
    let actualTests = 0;
    const invTol = 1.0 / tolerance;
    const tolSq = tolerance * tolerance;

    for (let i = 0; i < cPos.length / 3; i += step) {
      actualTests++;
      const idx = i * 3;
      
      const v = vec3.fromValues(cPos[idx], cPos[idx+1], cPos[idx+2]);
      vec3.transformMat4(v, v, transform);
      
      const cx = Math.round(v[0] * invTol);
      const cy = Math.round(v[1] * invTol);
      const cz = Math.round(v[2] * invTol);
      
      let found = false;
      // Search 3x3x3 neighboring hash cells
      for (let ox = -1; ox <= 1 && !found; ox++) {
        for (let oy = -1; oy <= 1 && !found; oy++) {
          for (let oz = -1; oz <= 1 && !found; oz++) {
            const hash = `${cx+ox}_${cy+oy}_${cz+oz}`;
            if (base.spatialHash.has(hash)) {
              const pts = base.spatialHash.get(hash);
              for (let pt of pts) {
                const dx = pt[0]-v[0], dy = pt[1]-v[1], dz = pt[2]-v[2];
                if (dx*dx+dy*dy+dz*dz <= tolSq) {
                  found = true; break;
                }
              }
            }
          }
        }
      }
      if (found) matchCount++;
    }
    
    // Pass if 85% of vertices match (forgives decimation/float shimmers while rejecting totally different meshes)
    return (matchCount / actualTests) >= 0.85;
  }

  computeAllWorldMatrices(json) {
    const worldMatrices = new Array(json.nodes.length).fill(null);
    const compute = (nodeIdx, parentMatrix) => {
      const node = json.nodes[nodeIdx];
      let localMatrix = mat4.create();

      if (node.matrix) {
        mat4.copy(localMatrix, node.matrix);
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
        for (const childIdx of node.children) compute(childIdx, worldMatrix);
      }
    };

    const sceneIdx = json.scene || 0;
    const sceneNodes = json.scenes[sceneIdx].nodes;
    for (const nodeIdx of sceneNodes) compute(nodeIdx, null);
    
    return worldMatrices;
  }

  async processMesh(meshMetadata, json, internalBinary) {
    const primitiveModels = [];
    for (let primIdx = 0; primIdx < meshMetadata.primitives.length; primIdx++) {
      const primitive = meshMetadata.primitives[primIdx];
      const rawModelData = new ModelData(meshMetadata.name || "Mesh");
      rawModelData.sourcePrimIdx = primIdx; 
      
      rawModelData.vertex_positions = await this.getBufferData(primitive.attributes.POSITION, json, internalBinary);
      const normals = await this.getBufferData(primitive.attributes.NORMAL, json, internalBinary);
      const uvs = await this.getBufferData(primitive.attributes.TEXCOORD_0, json, internalBinary);
      const indices = await this.getBufferData(primitive.indices, json, internalBinary);

      if (normals) rawModelData.vertex_normals = new Float32Array(normals);
      if (uvs) rawModelData.vertex_texcoords = new Float32Array(uvs);
      
      rawModelData.index_positions = indices instanceof Uint16Array ? new Uint32Array(indices) : indices;
      rawModelData.index_normals = new Uint32Array(rawModelData.index_positions);
      rawModelData.index_texcoords = new Uint32Array(rawModelData.index_positions);

      const splits = this.splitDisconnected(rawModelData);
      primitiveModels.push(...splits);
    }
    return primitiveModels;
  }

  normalizeScene(instances) {
    if (instances.length === 0) return;

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];

    instances.forEach(inst => {
      const worldMat = mat4.create();
      mat4.invert(worldMat, inst.invMatrix); 

      // NEW: Since primitives don't have .model, we supply tight mathematical bounds manually
      let bMin, bMax;
      if (inst.model) {
        bMin = inst.model.canonicalMin || [-1, -1, -1];
        bMax = inst.model.canonicalMax || [1, 1, 1];
      } else {
        var b = inst.getBounds();
        bMin = b.min; bMax = b.max;
      }

      for (let x of [bMin[0], bMax[0]]) {
        for (let y of [bMin[1], bMax[1]]) {
          for (let z of [bMin[2], bMax[2]]) {
            const v = vec3.fromValues(x, y, z);
            vec3.transformMat4(v, v, worldMat);
            for (let j = 0; j < 3; j++) {
              min[j] = Math.min(min[j], v[j]);
              max[j] = Math.max(max[j], v[j]);
            }
          }
        }
      }
    });

    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const maxDim = Math.max(size[0], size[1], size[2]);
    const scaleFactor = Math.min(Math.max(maxDim, 0.5), 50) / (maxDim || 1);

    const centerX = (min[0] + max[0]) / 2;
    const centerZ = (min[2] + max[2]) / 2;
    const bottomY = min[1]; 

    const globalTransform = mat4.create();
    mat4.scale(globalTransform, globalTransform, [scaleFactor, scaleFactor, scaleFactor]);
    mat4.translate(globalTransform, globalTransform, [-centerX, -bottomY, -centerZ]);

    instances.forEach(inst => {
      const currentWorld = mat4.create();
      mat4.invert(currentWorld, inst.invMatrix);
      
      const newWorld = mat4.create();
      mat4.multiply(newWorld, globalTransform, currentWorld);

      if (mat4.invert(inst.invMatrix, newWorld)) {
        mat4.getTranslation(inst.position, newWorld);
        mat4.getRotation(inst.rotation, newWorld);
        mat4.getScaling(inst.scale, newWorld);
      } else {
        mat4.identity(inst.invMatrix);
      }
    });
  }

  async getBufferData(accessorIdx, json, internalBinary) {
    if (accessorIdx === undefined) return null;
    const acc = json.accessors[accessorIdx];
    const view = json.bufferViews[acc.bufferView];
    const buffer = json.buffers[view.buffer];
    
    let bin;
    if (!buffer.uri) {
      bin = internalBinary;
    } else {
      const blobUrl = this.resolveUri(buffer.uri); 
      const res = await fetch(blobUrl);
      bin = await res.arrayBuffer();
    }

    const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || 0; 
    
    const numComponents = acc.type === 'VEC4' ? 4 : acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : 1;
    const totalElements = acc.count * numComponents;
    const componentSize = (acc.componentType === 5126 || acc.componentType === 5125) ? 4 : acc.componentType === 5123 ? 2 : 1;
    const defaultStride = numComponents * componentSize;

    if (stride === 0 || stride === defaultStride) {
      if (acc.componentType === 5126) return new Float32Array(bin, offset, totalElements);
      if (acc.componentType === 5123) return new Uint16Array(bin, offset, totalElements);
      if (acc.componentType === 5125) return new Uint32Array(bin, offset, totalElements);
    } else {
      const dataView = new DataView(bin);
      let result;
      if (acc.componentType === 5126) result = new Float32Array(totalElements);
      else if (acc.componentType === 5123) result = new Uint16Array(totalElements);
      else if (acc.componentType === 5125) result = new Uint32Array(totalElements);

      for (let i = 0; i < acc.count; i++) {
        const byteIndex = offset + (i * stride);
        for (let j = 0; j < numComponents; j++) {
          const flatIndex = (i * numComponents) + j;
          if (acc.componentType === 5126) result[flatIndex] = dataView.getFloat32(byteIndex + (j * 4), true); 
          else if (acc.componentType === 5123) result[flatIndex] = dataView.getUint16(byteIndex + (j * 2), true);
          else if (acc.componentType === 5125) result[flatIndex] = dataView.getUint32(byteIndex + (j * 4), true);
        }
      }
      return result;
    }
    return null;
  }

  createMaterial(gltfMat, json, bin) {
    const pbr = gltfMat.pbrMetallicRoughness || {};
    const ext = gltfMat.extensions || {};

    const options = {
      metallic: pbr.metallicFactor ?? 1.0,
      roughness: pbr.roughnessFactor ?? 1.0,
      ior: ext.KHR_materials_ior?.ior ?? 1.5,
      transmission: ext.KHR_materials_transmission?.transmissionFactor ?? 0.0,
      clearcoat: ext.KHR_materials_clearcoat?.clearcoatFactor ?? 0.0,
      clearcoatGloss: 1.0 - (ext.KHR_materials_clearcoat?.clearcoatRoughnessFactor ?? 0.0),
      clearcoatIor: 1.5,
      sheen: ext.KHR_materials_sheen?.sheenColorFactor ? 1.0 : 0.0,
      sheenTint: 0.5,
      specularTint: ext.KHR_materials_specular?.specularColorFactor ? 1.0 : 0.0,
      emittance: gltfMat.emissiveFactor || [0, 0, 0],
      emissionIntensity: ext.KHR_materials_emissive_strength?.emissiveStrength ?? 1.0,
    };

    const baseColor = pbr.baseColorFactor ? [pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2]] : [1, 1, 1];
    var name = gltfMat.name || "GLB_Mat";

    if (pbr.baseColorTexture) options.albedoTex = this.extractTexture(pbr.baseColorTexture.index, json, bin, name+"_baseColor");
    if (gltfMat.normalTexture) options.normalTex = this.extractTexture(gltfMat.normalTexture.index, json, bin, name+"_normal");
    if (pbr.metallicRoughnessTexture) options.roughnessTex = options.metallicTex = this.extractTexture(pbr.metallicRoughnessTexture.index, json, bin, name+"_metallicRoughness");
    if (gltfMat.emissiveTexture) options.emissiveTex = this.extractTexture(gltfMat.emissiveTexture.index, json, bin, name+"_emissive");

    return new Material(name, baseColor, options.roughness, options);
  }

  extractTexture(idx, json, bin, name) {
    if (this.textureCache.has(idx)) return this.textureCache.get(idx);
    const texture = json.textures[idx];
    const image = json.images[texture.source];
    var url;
    if (image.bufferView !== undefined) {
      const view = json.bufferViews[image.bufferView];
      const blob = new Blob([new Uint8Array(bin, view.byteOffset, view.byteLength)], { type: image.mimeType });
      url = URL.createObjectURL(blob);
    } else if (image.uri) {
      url = this.resolveUri(image.uri); 
    }

    const tex = new Texture(url, name);
    this.textureCache.set(idx, tex);
    return tex;
  }

  collectAssets(instances, materials) {
    const mats = [...new Set(instances.map(i => i.material))];
    const texs = [];
    mats.forEach(m => {
      ['albedoTex', 'normalTex', 'roughnessTex', 'metallicTex', 'emissiveTex'].forEach(prop => {
        if (m[prop] && !texs.includes(m[prop])) texs.push(m[prop]);
      });
    });
    const models = [...new Set(instances.map(i => i.model))];
    return { mats, texs, models };
  }
}

class GLTFExporter {
  constructor() {
    this.glTF = {
      asset: { version: "2.0", generator: "PathTracer GLB Exporter" },
      scenes: [{ nodes: [] }],
      scene: 0,
      nodes: [],
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      buffers: [],
      bufferViews: [],
      accessors: [],
      extensionsUsed: [],
      extensionsRequired: []
    };
    
    this.binaryData = [];
    this.byteOffset = 0;
    
    this.meshMap = new Map();
    this.materialMap = new Map();
    this.textureMap = new Map();

    this.dummyMeshIndex = -1;
  }

  addExtension(name) {
    if (!this.glTF.extensionsUsed.includes(name)) {
      this.glTF.extensionsUsed.push(name);
    }
  }

  async exportScene(objects, filename = "scene.glb") {
    console.log("Starting GLB export...");

    // 1. Process all objects
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const nodeIndex = this.glTF.nodes.length;
      this.glTF.scenes[0].nodes.push(nodeIndex);

      const node = {
        name: obj.name || `Object_${i}`,
        translation: obj.position ? Array.from(obj.position) : [0, 0, 0],
        rotation: obj.rotation ? Array.from(obj.rotation) : [0, 0, 0, 1], // Quaternions
        scale: obj.scale ? Array.from(obj.scale) : [1, 1, 1]
      };

      const matIndex = await this.processMaterial(obj.material);
      const objType = obj.constructor.name;

      if (objType === "Model" && obj.model) {
        node.mesh = this.processMesh(obj.model, matIndex);
      } else {
        // It's a Primitive! Add custom flags so our loader knows what it really is
        node.extras = { ptracer_primitive: objType };
        if (objType == "Cylinder" && obj.top_radius !== undefined) node.extras.top_radius = obj.top_radius;
        if (objType == "Frustum" && obj.inner_radius !== undefined) node.extras.inner_radius = obj.inner_radius;
        
        // Export physical representation if available
        if (typeof obj.generateMesh === 'function') {
          const rawMesh = obj.generateMesh();
          const mockModel = {
            vertex_positions: new Float32Array(rawMesh.p),
            vertex_normals: rawMesh.n ? new Float32Array(rawMesh.n) : undefined,
            vertex_texcoords: rawMesh.u ? new Float32Array(rawMesh.u) : undefined,
            index_positions: new Uint32Array(rawMesh.i)
          };
          node.mesh = this.processMesh(mockModel, matIndex, `Primitive_${objType}`);
        } else {
          node.mesh = this.getDummyMesh(matIndex);
        }
      }

      this.glTF.nodes.push(node);
    }

    // 2. Build Binary Buffer
    const totalBinaryLength = this.binaryData.reduce((acc, arr) => acc + arr.byteLength, 0);
    const binPadding = (4 - (totalBinaryLength % 4)) % 4;
    const finalBinLength = totalBinaryLength + binPadding;

    this.glTF.buffers.push({ byteLength: finalBinLength });
    if (this.glTF.extensionsUsed.length === 0) delete this.glTF.extensionsUsed;
    if (this.glTF.extensionsRequired.length === 0) delete this.glTF.extensionsRequired;

    // 3. Create GLB Structure
    const jsonString = JSON.stringify(this.glTF);
    const jsonBytes = new TextEncoder().encode(jsonString);
    const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
    const finalJsonLength = jsonBytes.length + jsonPadding;

    const glbLength = 12 + 8 + finalJsonLength + 8 + finalBinLength;
    const glbBuffer = new ArrayBuffer(glbLength);
    const glbView = new DataView(glbBuffer);
    const glbUint8 = new Uint8Array(glbBuffer);

    // Header
    glbView.setUint32(0, 0x46546C67, true); // "glTF"
    glbView.setUint32(4, 2, true); // Version 2
    glbView.setUint32(8, glbLength, true);

    // JSON Chunk
    glbView.setUint32(12, finalJsonLength, true);
    glbView.setUint32(16, 0x4E4F534A, true); // "JSON"
    glbUint8.set(jsonBytes, 20);
    for (let i = 0; i < jsonPadding; i++) glbUint8[20 + jsonBytes.length + i] = 0x20; 

    // BIN Chunk
    const binChunkOffset = 20 + finalJsonLength;
    glbView.setUint32(binChunkOffset, finalBinLength, true);
    glbView.setUint32(binChunkOffset + 4, 0x004E4942, true); // "BIN\0"
    
    let currentOffset = binChunkOffset + 8;
    for (let chunk of this.binaryData) {
      glbUint8.set(new Uint8Array(chunk), currentOffset);
      currentOffset += chunk.byteLength;
    }

    // 4. Download
    const blob = new Blob([glbBuffer], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    console.log("Export complete!");
  }

  appendBuffer(arrayBuffer) {
    const pad = (4 - (arrayBuffer.byteLength % 4)) % 4;
    const viewIndex = this.glTF.bufferViews.length;
    
    this.glTF.bufferViews.push({
      buffer: 0,
      byteOffset: this.byteOffset,
      byteLength: arrayBuffer.byteLength
    });

    this.binaryData.push(arrayBuffer);
    this.byteOffset += arrayBuffer.byteLength;

    if (pad > 0) {
      this.binaryData.push(new ArrayBuffer(pad));
      this.byteOffset += pad;
    }
    return viewIndex;
  }

  processMesh(modelData, materialIndex, customSig) {
    // Generate an absolute unique ID to prevent wrong meshes from merging
    if (!modelData._gltf_id) {
        modelData._gltf_id = "mesh_" + Math.random().toString(36).substr(2, 9);
    }
    
    const sig = customSig ? (customSig + "_" + materialIndex) : (modelData._gltf_id + "_" + materialIndex);
    
    if (this.meshMap.has(sig)) {
      return this.meshMap.get(sig);
    }

    // CRITICAL CORRUPTION FIX:
    // By creating a *new* TypedArray, we strip away the underlying parent buffer. 
    // If modelData was sliced from a 50MB shared .bin array, this guarantees we only export the slice!
    const posData = new Float32Array(modelData.vertex_positions);
    const posView = this.appendBuffer(posData.buffer);
    
    const attributes = { POSITION: this.glTF.accessors.length };
    
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posData.length; i += 3) {
      min[0] = Math.min(min[0], posData[i]); max[0] = Math.max(max[0], posData[i]);
      min[1] = Math.min(min[1], posData[i+1]); max[1] = Math.max(max[1], posData[i+1]);
      min[2] = Math.min(min[2], posData[i+2]); max[2] = Math.max(max[2], posData[i+2]);
    }

    this.glTF.accessors.push({ bufferView: posView, componentType: 5126, count: posData.length / 3, type: "VEC3", min, max });

    if (modelData.vertex_normals && modelData.vertex_normals.length > 0) {
      const normData = new Float32Array(modelData.vertex_normals);
      const normView = this.appendBuffer(normData.buffer);
      attributes.NORMAL = this.glTF.accessors.length;
      this.glTF.accessors.push({ bufferView: normView, componentType: 5126, count: normData.length / 3, type: "VEC3" });
    }
    
    if (modelData.vertex_texcoords && modelData.vertex_texcoords.length > 0) {
      const uvData = new Float32Array(modelData.vertex_texcoords);
      const uvView = this.appendBuffer(uvData.buffer);
      attributes.TEXCOORD_0 = this.glTF.accessors.length;
      this.glTF.accessors.push({ bufferView: uvView, componentType: 5126, count: uvData.length / 2, type: "VEC2" });
    }

    // Force indexes to tightly packed buffer arrays
    const is32 = modelData.index_positions instanceof Uint32Array;
    const idxData = is32 ? new Uint32Array(modelData.index_positions) : new Uint16Array(modelData.index_positions);
    const idxView = this.appendBuffer(idxData.buffer);

    const idxAcc = this.glTF.accessors.length;
    this.glTF.accessors.push({ bufferView: idxView, componentType: is32 ? 5125 : 5123, count: idxData.length, type: "SCALAR" });

    const meshIndex = this.glTF.meshes.length;
    this.glTF.meshes.push({
      primitives: [{
        attributes: attributes,
        indices: idxAcc,
        material: materialIndex
      }]
    });

    this.meshMap.set(sig, meshIndex);
    return meshIndex;
  }

  getDummyMesh(matIndex) {
    const sig = "dummy_" + matIndex;
    if (this.meshMap.has(sig)) return this.meshMap.get(sig);

    if (this.dummyMeshIndex === -1) {
      const pos = new Float32Array([0,0,0, 0.001,0,0, 0,0.001,0]);
      const norm = new Float32Array([0,0,1, 0,0,1, 0,0,1]);
      const uv = new Float32Array([0,0, 1,0, 0,1]);
      const idx = new Uint16Array([0,1,2]);
      
      const pV = this.appendBuffer(pos.buffer);
      const nV = this.appendBuffer(norm.buffer);
      const uV = this.appendBuffer(uv.buffer);
      const iV = this.appendBuffer(idx.buffer);

      const baseAcc = this.glTF.accessors.length;
      this.glTF.accessors.push({ bufferView: pV, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [0.001,0.001,0] });
      this.glTF.accessors.push({ bufferView: nV, componentType: 5126, count: 3, type: "VEC3" });
      this.glTF.accessors.push({ bufferView: uV, componentType: 5126, count: 3, type: "VEC2" });
      this.glTF.accessors.push({ bufferView: iV, componentType: 5123, count: 3, type: "SCALAR" });

      this.dummyMeshData = {
        attributes: { POSITION: baseAcc, NORMAL: baseAcc+1, TEXCOORD_0: baseAcc+2 },
        indices: baseAcc+3
      };
      this.dummyMeshIndex = 1;
    }
    
    const meshIndex = this.glTF.meshes.length;
    this.glTF.meshes.push({
      primitives: [{
        attributes: this.dummyMeshData.attributes,
        indices: this.dummyMeshData.indices,
        material: matIndex
      }]
    });
    
    this.meshMap.set(sig, meshIndex);
    return meshIndex;
  }

  async processMaterial(mat) {
    if (!mat) return undefined;
    if (this.materialMap.has(mat)) return this.materialMap.get(mat);

    const gltfMat = {
      name: mat.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...(mat.color || [1,1,1]), 1.0],
        metallicFactor: mat.metallic ?? 1.0,
        roughnessFactor: mat.roughness ?? 1.0
      },
      extensions: {}
    };

    if (mat.emittance && (mat.emittance[0] > 0 || mat.emittance[1] > 0 || mat.emittance[2] > 0)) {
        gltfMat.emissiveFactor = mat.emittance;
    }

    if (mat.albedoTex) gltfMat.pbrMetallicRoughness.baseColorTexture = { index: await this.processTexture(mat.albedoTex) };
    if (mat.normalTex) gltfMat.normalTexture = { index: await this.processTexture(mat.normalTex) };
    if (mat.metallicTex) gltfMat.pbrMetallicRoughness.metallicRoughnessTexture = { index: await this.processTexture(mat.metallicTex) };
    if (mat.emissiveTex) gltfMat.emissiveTexture = { index: await this.processTexture(mat.emissiveTex) };

    if (mat.ior && mat.ior !== 1.5) {
      this.addExtension("KHR_materials_ior");
      gltfMat.extensions.KHR_materials_ior = { ior: mat.ior };
    }
    if (mat.transmission && mat.transmission > 0) {
      this.addExtension("KHR_materials_transmission");
      gltfMat.extensions.KHR_materials_transmission = { transmissionFactor: mat.transmission };
    }
    if (mat.clearcoat && mat.clearcoat > 0) {
      this.addExtension("KHR_materials_clearcoat");
      gltfMat.extensions.KHR_materials_clearcoat = { clearcoatFactor: mat.clearcoat, clearcoatRoughnessFactor: 1.0 - (mat.clearcoatGloss || 1.0) };
    }
    if (mat.emissionIntensity !== undefined && mat.emissionIntensity !== 1.0) {
      this.addExtension("KHR_materials_emissive_strength");
      gltfMat.extensions.KHR_materials_emissive_strength = { emissiveStrength: mat.emissionIntensity };
    }

    if (Object.keys(gltfMat.extensions).length === 0) delete gltfMat.extensions;

    const index = this.glTF.materials.length;
    this.glTF.materials.push(gltfMat);
    this.materialMap.set(mat, index);
    return index;
  }

  async processTexture(tex) {
    if (!tex || !tex.url) return undefined;
    if (this.textureMap.has(tex)) return this.textureMap.get(tex);

    let arrayBuffer;
    let mimeType = "image/png";

    try {
      const res = await fetch(tex.url);
      arrayBuffer = await res.arrayBuffer();
      mimeType = res.headers.get("content-type") || "image/png";
    } catch (e) {
      console.warn("Failed to fetch texture for export:", tex.url);
      arrayBuffer = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,11,73,68,65,84,8,215,99,248,15,4,0,9,251,3,253,227,85,242,156,0,0,0,0,73,69,78,68,174,66,96,130]).buffer;
    }

    const viewIndex = this.appendBuffer(arrayBuffer);
    
    const imageIndex = this.glTF.images.length;
    this.glTF.images.push({ bufferView: viewIndex, mimeType });

    const texIndex = this.glTF.textures.length;
    this.glTF.textures.push({ sampler: 0, source: imageIndex, name: tex.name });

    this.textureMap.set(tex, texIndex);
    return texIndex;
  }
}
