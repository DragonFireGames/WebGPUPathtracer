// Animation panel state and functions
const AnimationPanel = {
  items: new Map(), // Map of node id -> node name
  keyframes: new Map(), // Map of node id -> array of {time, position, rotation, scale}
  isPlaying: false,
  currentTime: 0, // in seconds
  duration: 10, // 10
  lastFrameTime: 0,
  animationFrameId: null,

  reset() {
    this.items = new Map();
    this.keyframes = new Map();
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 10;
    this.lastFrameTime = 0;
    this.animationFrameId = null;
  },

  addItem(nodeId, nodeName, noRender) {
    if (!this.items.has(nodeId)) {
      this.items.set(nodeId, nodeName);
      this.keyframes.set(nodeId, []);
      if (!noRender) this.render();
      if (!noRender) this.updateSeeker();
    }
  },

  removeItem(nodeId, noRender) {
    this.items.delete(nodeId);
    this.keyframes.delete(nodeId);
    if (!noRender) this.render();
    if (!noRender) this.updateSeeker();
  },

  insertKeyframe(nodeId, noRender) {
    const node = nodeId == 'camera' ? State.scene.camera : State.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Add item to animation if it doesn't exist
    if (!this.items.has(nodeId)) {
      this.addItem(nodeId, node.name, noRender);
    }

    const keyframes = this.keyframes.get(nodeId) || [];
    const newKeyframe = node.type == "Camera" ? {
      time: this.currentTime,
      target: [...node.target],
      position: [...node.position],
      easing: "linear",
    } : {
      time: this.currentTime,
      position: [...node.position],
      rotation: [...node.rotation],
      scale: [...node.scale],
      easing: "linear",
    };

    // Remove existing keyframe at this time if it exists
    const existingIndex = keyframes.findIndex(
      (k) => Math.abs(k.time - this.currentTime) < 0.0001,
    );
    if (existingIndex !== -1) {
      keyframes[existingIndex] = newKeyframe;
    } else {
      keyframes.push(newKeyframe);
      keyframes.sort((a, b) => a.time - b.time);
    }

    this.keyframes.set(nodeId, keyframes);
    if (!noRender) this.render();
  },

  removeKeyframe(nodeId, time) {
    const keyframes = this.keyframes.get(nodeId) || [];
    const index = keyframes.findIndex(
      (k) => Math.abs(k.time - time) < 0.01,
    );
    if (index !== -1) {
      keyframes.splice(index, 1);
      this.keyframes.set(nodeId, keyframes);
      this.render();
    }
  },

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    const btn = document.getElementById("animation-play-btn");
    btn.textContent = this.isPlaying ? "⏸" : "▶";

    if (this.isPlaying) {
      this.lastFrameTime = performance.now();
      this.startAnimation();
    } else if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  },

  startAnimation() {
    const animate = (currentTime) => {
      if (!this.isPlaying) return;

      const deltaTime = (currentTime - this.lastFrameTime) / 1000; // convert to seconds
      this.lastFrameTime = currentTime;

      this.currentTime += deltaTime;
      if (this.currentTime >= this.duration) {
        this.currentTime = 0; // loop
      }

      this.updateUI();
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  },

  getTimeStr(time) {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return minutes+":"+seconds.toString().padStart(2, "0");
  },

  updateUI() {
    // Update time display
    const display = this.getTimeStr(this.currentTime)+" / "+this.getTimeStr(this.duration);
    document.getElementById("animation-time").textContent = display;

    // Update seeker position
    const seeker = document.getElementById("animation-seeker");
    const wrapper = document.getElementById("animation-lanes-wrapper");
    const offsetLeft = 86; // Width of remove button + label
    const percent = this.currentTime / this.duration;
    const contentWidth = wrapper.offsetWidth - offsetLeft;
    seeker.style.left = offsetLeft + percent * contentWidth + "px";

    // Update animated entities
    this.updateAnimatedEntities();
  },

  updateSeeker() {
    const seeker = document.getElementById("animation-seeker");
    if (seeker) {
      seeker.style.display = this.items.size === 0 ? "none" : "block";
    }
  },

  easingFunctions: {
    linear: (t) => t,
    quadratic: (t) => t * t,
    cubic: (t) => t * t * t,
    exponential: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  },

  applyEasing(t, easingType = "linear") {
    const fn = this.easingFunctions[easingType] || this.easingFunctions.linear;
    return fn(t);
  },

  setKeyframeEasing(nodeId, time, easingType) {
    const keyframes = this.keyframes.get(nodeId) || [];
    const keyframe = keyframes.find((k) => Math.abs(k.time - time) < 0.01);
    if (keyframe) {
      keyframe.easing = easingType;
      this.render();
    }
  },

  updateAnimatedEntities() {
    // For each animated item, find keyframes and interpolate
    for (const [nodeId, keyframes] of this.keyframes.entries()) {
      if (keyframes.length === 0) continue;

      const node = nodeId == 'camera' ? State.scene.camera : State.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      // Find the keyframes to interpolate between
      let kf1 = null, kf2 = null;
      for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i].time <= this.currentTime) {
          kf1 = keyframes[i];
        }
        if (keyframes[i].time >= this.currentTime && !kf2) {
          kf2 = keyframes[i];
        }
      }
      if (kf1 && kf2 && kf1 !== kf2) {
        // Interpolate between keyframes with easing
        let t = (this.currentTime - kf1.time) / (kf2.time - kf1.time);
        t = this.applyEasing(t, kf1.easing);
        vec3.lerp(node.position,kf1.position,kf2.position,t);
        if (node.type == "Camera") {
          vec3.lerp(node.target,kf1.target,kf2.target,t);
        } else {
          quat.slerp(node.rotation,kf1.rotation,kf2.rotation,t);
          vec3.lerp(node.scale,kf1.scale,kf2.scale,t);
        }
      } else if (kf1 && !kf2 || kf1 === kf2) {
        // Use the last keyframe
        node.position = [...kf1.position];
        if (node.type == "Camera") {
          node.target = [...kf1.target];
        } else {
          node.position = [...kf1.position];
          node.rotation = [...kf1.rotation];
          node.scale = [...kf1.scale];
        }
      } else if (!kf1 && kf2) {
        // Use the first keyframe
        node.position = [...kf2.position];
        if (node.type == "Camera") {
          node.target = [...kf2.target];
        } else {
          node.rotation = [...kf2.rotation];
          node.scale = [...kf2.scale];
        }
      }
      if (node.type == "Camera") {
        Cam.updateOrbit(node.position,node.target);
        node.updateRays();
      } else node.updateMatrix();
    }
  },

  render() {
    const lanes = document.getElementById("animation-lanes");
    const empty = document.getElementById("animation-empty-state");

    if (this.items.size === 0) {
      lanes.innerHTML = "";
      empty.style.display = "block";
      return;
    }

    empty.style.display = "none";
    lanes.innerHTML = Array.from(this.items.entries())
      .map(([id, name]) => {
        const keyframes = this.keyframes.get(id) || [];
        const keyframeElements = keyframes
          .map(
            (kf) => `
      <div 
      class="animation-keyframe" 
      style="left: ${(kf.time / this.duration) * 100}%"
      data-node-id="${id}"
      data-keyframe-time="${kf.time}"
      data-easing="${kf.easing || "linear"}"
      oncontextmenu="AnimationPanel.showKeyframeMenu(event, '${id}', ${kf.time})" 
      title="${kf.easing || "linear"} - Right-click for options"
      >◆</div>
    `,
          )
          .join("");

        return `
    <div class="animation-lane">
      <button class="animation-lane-remove" onclick="AnimationPanel.removeItem('${id}')" title="Remove">×</button>
      <div class="animation-lane-label" title="${name}">${name}</div>
      <div class="animation-lane-content">
      ${keyframeElements}
      </div>
    </div>
    `;
      })
      .join("");
    this.updateSeeker();
  },

  showKeyframeMenu(event, nodeId, time) {
    event.preventDefault();
    const menu = document.getElementById("keyframe-context-menu");
    if (!menu) return;

    menu.style.display = "block";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";

    // Store current keyframe info for menu actions
    window.currentKeyframeContext = { nodeId, time };
  },
};

// Setup animation drop zone
function setupAnimationDropZone() {
  const dropZone = document.getElementById("animation-drop-zone");
  if (!dropZone) return;

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    const nodeId = e.dataTransfer.getData("text/plain");
    if (nodeId) {
      const node = State.nodes.find((n) => n.id === nodeId);
      if (node) {
        AnimationPanel.addItem(nodeId, node.name);
      }
    }
  });
}

// Setup timeline seeking
function setupTimelineSeeker() {
  const lanesWrapper = document.getElementById("animation-lanes-wrapper");
  if (!lanesWrapper) return;

  const offsetLeft = 86; // Width of remove button + label

  lanesWrapper.addEventListener("click", (e) => {
    const rect = lanesWrapper.getBoundingClientRect();
    const contentWidth = rect.width - offsetLeft;
    const clickX = e.clientX - rect.left - offsetLeft;
    const percent = Math.max(0, Math.min(1, clickX / contentWidth));
    AnimationPanel.currentTime = percent * AnimationPanel.duration;
    AnimationPanel.updateUI();
  });

  // Allow dragging the seeker
  const seeker = document.getElementById("animation-seeker");
  let isDragging = false;

  seeker.addEventListener("mousedown", () => {
    isDragging = true;
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const rect = lanesWrapper.getBoundingClientRect();
    const contentWidth = rect.width - offsetLeft;
    const moveX = e.clientX - rect.left - offsetLeft;
    const percent = Math.max(0, Math.min(1, moveX / contentWidth));
    AnimationPanel.currentTime = percent * AnimationPanel.duration;
    AnimationPanel.updateUI();
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

// Initialize animation system when DOM is ready
function initializeAnimation() {
  setupAnimationDropZone();
  setupTimelineSeeker();
  AnimationPanel.updateSeeker();
}

function setEasing(easing) {
  AnimationPanel.setKeyframeEasing(window.currentKeyframeContext.nodeId, window.currentKeyframeContext.time, easing); 
  document.getElementById('keyframe-context-menu').style.display = 'none';
}

function removeKeyframe() {
  AnimationPanel.removeKeyframe(window.currentKeyframeContext.nodeId, window.currentKeyframeContext.time); 
  document.getElementById('keyframe-context-menu').style.display = 'none';
}

async function recordCamera() {
  var areset = confirm("Reset the camera?");
  var fps = Number(prompt("Enter framerate:","24")||24);
  var dur = Number(prompt("Enter duration:","1")||1);
  await wait(2000);
  var dt = 1/fps;
  if (areset) {
    AnimationPanel.currentTime = 0;
    AnimationPanel.removeItem('camera',false);
  }
  for (var i = 0; i < fps * dur; i++) {
    AnimationPanel.insertKeyframe('camera',false);
    AnimationPanel.currentTime += dt;
    AnimationPanel.updateUI();
    await wait(dt*1000);
  }
  AnimationPanel.insertKeyframe('camera',false);
}

function loadJSON(url, callback) {
  const container = {};   // returned immediately
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        // Replace container with an array and copy elements 
        container.length = 0; 
        // ensure it's array-like 
        Object.setPrototypeOf(container, Array.prototype); 
        data.forEach(v => container.push(v)); 
        } else {
          // Normal object case 
          Object.assign(container, data);
        }
      if (callback) callback(container);
    })
    .catch(err => {
      console.error("loadJSON error:", err);
      if (callback) callback(null, err);
    });
  return container;
}

class ConvexCollider {
  constructor() {
    this.hulls = [];
    //this.localOffset = [0,0,0];
  }
  loadFromJSON(url) {
    this.loaded = new Promise(res=>{
      this.hulls = loadJSON(url, res);
    });
    return this;
  }
  hullsToOBJ() {
    let obj = "";
    let vertexOffset = 1;

    this.hulls.forEach((hull, hullIndex) => {
      const verts = hull.verts;
      const faces = hull.faces;
      const [ox, oy, oz] = hull.offset;

      // Optional: name each hull
      obj += `o hull_${hullIndex}\n`;

      // Write vertices
      for (let i = 0; i < verts.length; i += 3) {
        const x = verts[i] + ox;
        const y = verts[i + 1] + oy;
        const z = verts[i + 2] + oz;
        obj += `v ${x} ${y} ${z}\n`;
      }

      // Write faces (convert 0‑indexed → 1‑indexed)
      for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i] + vertexOffset;
        const b = faces[i + 1] + vertexOffset;
        const c = faces[i + 2] + vertexOffset;
        obj += `f ${a} ${b} ${c}\n`;
      }

      vertexOffset += verts.length / 3;
    });

    return obj;
  }
  renormalize() {
    let min = vec3.fromValues(Infinity, Infinity, Infinity);
    let max = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    // 1. Find Bounding Box
    this.hulls.forEach(hull => {
      for (let i = 0; i < hull.verts.length; i += 3) {
        const x = hull.verts[i] + hull.offset[0];
        const y = hull.verts[i+1] + hull.offset[1];
        const z = hull.verts[i+2] + hull.offset[2];
        
        min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
      }
    });

    // 2. Calculate Center and Scale
    const center = vec3.create();
    vec3.add(center, min, max);
    vec3.scale(center, center, -0.5); // Negative center for translation

    let maxDistSq = 0;
    this.hulls.forEach(hull => {
      for (let i = 0; i < hull.verts.length; i += 3) {
        const x = hull.verts[i] + hull.offset[0] + center[0];
        const y = hull.verts[i+1] + hull.offset[1] + center[1];
        const z = hull.verts[i+2] + hull.offset[2] + center[2];
        const d2 = x*x + y*y + z*z;
        if (d2 > maxDistSq) maxDistSq = d2;
      }
    });

    const scalar = 1.0 / Math.sqrt(maxDistSq);

    // 3. Bake the normalization transform
    const normalizationMat = mat4.create();
    mat4.scale(normalizationMat, normalizationMat, [scalar, scalar, scalar]);
    mat4.translate(normalizationMat, normalizationMat, center);

    this.bakeTransform(normalizationMat);
  }
  bakeTransform(matrix) {
    const tempVec = vec3.create();
    const oldOffset = vec3.create();

    this.hulls.forEach(hull => {
      // 1. Transform the offset
      vec3.copy(oldOffset, hull.offset);
      vec3.transformMat4(hull.offset, hull.offset, matrix);

      // 2. Transform the vertices relative to the new offset
      for (let i = 0; i < hull.verts.length; i += 3) {
        // Current vertex in world space: hull.offset + localVert
        vec3.set(tempVec, 
          hull.verts[i] + oldOffset[0], 
          hull.verts[i+1] + oldOffset[1], 
          hull.verts[i+2] + oldOffset[2]
        );

        // Apply matrix
        vec3.transformMat4(tempVec, tempVec, matrix);

        // New local vertex: worldResult - newOffset
        hull.verts[i]     = tempVec[0] - hull.offset[0];
        hull.verts[i + 1] = tempVec[1] - hull.offset[1];
        hull.verts[i + 2] = tempVec[2] - hull.offset[2];
      }
    });
  }
  computeHullVolume(verts, faces) {
    let volume = 0;

    for (let i = 0; i < faces.length; i++) {
      const [ia, ib, ic] = faces[i];

      const a = verts[ia];
      const b = verts[ib];
      const c = verts[ic];

      // Compute scalar triple product a · (b × c)
      const cross = b.cross(c);
      const v = a.dot(cross);

      volume += v;
    }

    return Math.abs(volume) / 6;
  }
}

class PhysicsController {
  constructor(scene) {
    this.bodies = [];
    this.currentTime = 0;
    this.setScene(scene);
  }
  setScene(scene) {
    const objects = scene.objects;
    const materials = scene.getMaterials();

    var world = this.world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.solver.iterations = 20;
    world.defaultContactMaterial.contactEquationStiffness = 1e8;
    world.defaultContactMaterial.contactEquationRelaxation = 10;
    world.defaultContactMaterial.frictionEquationStiffness = 1e5;
    world.defaultContactMaterial.frictionEquationRelaxation = 3;

    this.materialMap = new Map();

    for (var i = 0; i < materials.length; i++) {
      materials[i].cannonMaterial = new CANNON.Material(materials[i].id);
    }

    // 2. Define how every material interacts with every other material
    for (let matA of materials) {
      for (let matB of materials) {
        const contact = new CANNON.ContactMaterial(matA.cannonMaterial, matB.cannonMaterial, {
          friction: Math.sqrt(matA.friction * matB.friction),
          restitution: Math.sqrt(matA.restitution * matB.restitution),
        });
        world.addContactMaterial(contact);
      }
    }

    this.bodies = [];
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      //if (!(obj instanceof TracerObject)) continue;
      var pos = {x:obj.position[0],y:obj.position[1],z:obj.position[2]};
      var quat = {x:obj.rotation[0],y:obj.rotation[1],z:obj.rotation[2],w:obj.rotation[3]};
      var scale = {x:obj.scale[0],y:obj.scale[1],z:obj.scale[2]};
      var localOffset = new CANNON.Vec3(0, 0, 0);

      var body;
      var density = obj.material.density;
      if (obj.type == "Sphere") {
        var radius = scale.x;
        var shape = new CANNON.Sphere(radius);
        var volume = 4/3*Math.PI*radius*radius*radius;
        body = new CANNON.Body({
          mass: volume * density,
          shape: shape
        });
      } else if (obj.type == "Cube") {
        var width = scale.x, height = scale.y, depth = scale.z;
        shape = new CANNON.Box(new CANNON.Vec3(width, height, depth));
        var volume = width*height*depth;
        body = new CANNON.Body({
          mass: volume * density,
          shape: shape
        });
      } else if (obj.type == "Plane") {
        shape = new CANNON.Plane();
        body = new CANNON.Body({
          mass: 0,
          shape: shape
        });
        const { normal } = obj.getOrientation();
        const q = new CANNON.Quaternion();
        q.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal[0], normal[1], normal[2]));
        quat = q;
      } else if (obj.type === "Cylinder") {
        const radiusTop = obj.top_radius * scale.x;
        const radiusBottom = scale.x;
        const height = scale.y;

        const r = obj.top_radius;
        const yComFromBottom = (height / 4) * ((1 + 2*r + 3*r*r) / (1 + r + r*r));
        const volume = (1/3) * Math.PI * height * (1 + r + r*r) * scale.x * scale.x;

        shape = new CANNON.Cylinder(radiusTop, radiusBottom, height, 24);
        localOffset.set(0, yComFromBottom, 0);

        body = new CANNON.Body({
          mass: volume * density,
        });
        body.addShape(shape, new CANNON.Vec3(0, (height / 2) - yComFromBottom, 0));
        body.updateMassProperties();
      } else if (obj.type == "Torus") {
        const majorRadius = scale.x;
        const tubeRadius = obj.inner_radius * scale.x;
        const majorSegments = 16;
        const tubeSegments = 8;

        const volume = (2 * Math.PI * majorRadius) * (Math.PI * tubeRadius * tubeRadius);
        body = new CANNON.Body({
          mass: volume * density
        });

        var generateWedgeFaces = function(segments) {
          const faces = [];
          for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            // Vertices 0..segments-1 are theta1 (slice A)
            // Vertices segments..2*segments-1 are theta2 (slice B)
            const a = i;
            const b = next;
            const c = next + segments;
            const d = i + segments;

            // Winding [a, b, c, d] points the normal OUTWARDS for these wedges
            faces.push([a, b, c, d]);
          }

          // Cap A (the slice at theta1) - Looking at the slice from outside the wedge
          const capA = [];
          for (let i = segments - 1; i >= 0; i--) {
            capA.push(i);
          }
          faces.push(capA);

          // Cap B (the slice at theta2) - Looking at the slice from outside the wedge
          const capB = [];
          for (let i = 0; i < segments; i++) {
            capB.push(i + segments);
          }
          faces.push(capB);

          return faces;
        };

        const wedgeFaces = generateWedgeFaces(tubeSegments);

        for (let i = 0; i < majorSegments; i++) {
          const theta1 = (i / majorSegments) * Math.PI * 2;
          const theta2 = ((i + 1) / majorSegments) * Math.PI * 2;
          const midTheta = (theta1 + theta2) / 2;

          // Local center of this wedge
          const offsetX = majorRadius * Math.cos(midTheta);
          const offsetY = 0;
          const offsetZ = majorRadius * Math.sin(midTheta);
          const shapeOffset = new CANNON.Vec3(offsetX, offsetY, offsetZ);

          const vertices = [];
          // Generate two circular slices of the tube
          [theta1, theta2].forEach(theta => {
            for (let j = 0; j < tubeSegments; j++) {
              const phi = (j / tubeSegments) * Math.PI * 2;
              const worldX = (majorRadius + tubeRadius * Math.cos(phi)) * Math.cos(theta);
              const worldY = tubeRadius * Math.sin(phi);
              const worldZ = (majorRadius + tubeRadius * Math.cos(phi)) * Math.sin(theta);

              // Center vertices around (0,0,0) for this specific shape
              vertices.push(new CANNON.Vec3(
                worldX - offsetX,
                worldY - offsetY,
                worldZ - offsetZ
              ));
            }
          });

          const shape = new CANNON.ConvexPolyhedron({
            vertices: vertices,
            faces: wedgeFaces
          });

          // Recalculate normals based on the new CCW order
          shape.computeNormals();
          shape.updateBoundingSphereRadius();

          body.addShape(shape, shapeOffset);
        }

        body.updateMassProperties();
        localOffset.set(0, 0, 0);
      } else if (obj.type == "Model" && obj.collider instanceof ConvexCollider) {
        // 1. Deep clone the hulls so we don't permanently mutate the shared asset
        const clonedHulls = JSON.parse(JSON.stringify(obj.collider.hulls));
      
        // 2. Apply Scale using a temporary ConvexCollider instance and glMatrix
        const tempCollider = new ConvexCollider();
        tempCollider.hulls = clonedHulls;
        const scaleMat = mat4.create();
        mat4.fromScaling(scaleMat, [scale.x, scale.y, scale.z]);
        tempCollider.bakeTransform(scaleMat);

        let totalVolume = 0;
        let hullData = [];

        // Step 1: Load scaled hulls, compute volume, store centroids + offsets
        for (let j = 0; j < tempCollider.hulls.length; j++) {
          const hull = tempCollider.hulls[j];
          const rawVerts = hull.verts;
          const rawFaces = hull.faces;
          const rawOffset = hull.offset;

          let verts = [];
          let faces = [];
          for (let k = 0; k < rawVerts.length; k += 3) {
            verts.push(new CANNON.Vec3(rawVerts[k], rawVerts[k+1], rawVerts[k+2]));
          }
          for (let k = 0; k < rawFaces.length; k += 3) {
            faces.push([rawFaces[k], rawFaces[k+1], rawFaces[k+2]]);
          }

          // Assuming computeHullVolume is still available in your scope
          const V = tempCollider.computeHullVolume(verts, faces);
          totalVolume += V;

          let centroid = new CANNON.Vec3(0, 0, 0);
          verts.forEach(v => centroid.vadd(v, centroid));
          centroid.scale(1 / verts.length, centroid);

          hullData.push({
            verts,
            faces,
            offset: new CANNON.Vec3(rawOffset[0], rawOffset[1], rawOffset[2]),
            volume: V,
            centroid
          });
        }

        // Step 2: Compute true COM (volume-weighted)
        let COM = new CANNON.Vec3(0, 0, 0);
        for (let h of hullData) {
          const worldCentroid = h.centroid.vadd(h.offset);
          COM.vadd(worldCentroid.scale(h.volume), COM);
        }
        COM.scale(1 / totalVolume, COM);

        // 3. Create body with temporary mass
        body = new CANNON.Body({ mass: 1 });

        // Step 3: Shift all hull offsets so COM becomes the local (0,0,0)
        for (let h of hullData) {
          h.offset.vsub(COM, h.offset);
          const part = new CANNON.ConvexPolyhedron({
            vertices: h.verts,
            faces: h.faces
          });
          body.addShape(part, h.offset);
        }

        // Step 4: Set actual mass and inertia
        body.mass = totalVolume * density;
        body.updateMassProperties();

        // Step 5: Feed the COM into your new architecture
        // The local vector from the Mesh Origin to the true COM is exactly our COM vector.
        localOffset.copy(COM);
      } else {
        alert("Physics for "+obj.type+" ("+obj.name+") aren't supported yet.");
        continue;
      }

      const worldOffset = new CANNON.Vec3();
      body.quaternion.vmult(localOffset, worldOffset); // Rotate offset to world space
      body.position.set(pos.x + worldOffset.x, pos.y + worldOffset.y, pos.z + worldOffset.z);
      body.shapeOffset = localOffset;
      body.quaternion.set(quat.x, quat.y, quat.z, quat.w);

      body.velocity.set(obj.velocity[0],obj.velocity[1],obj.velocity[2]);
      body.angularVelocity.set(obj.angularVelocity[0],obj.angularVelocity[1],obj.angularVelocity[2]);

      body.material = obj.material.cannonMaterial;

      world.addBody(body);
      body.renderer = obj;
      body.scale = scale;
      body.initialTransform = { pos, quat };
      obj.physicsbody = body;

      this.bodies.push(body);
    }

    this.bodies = this.bodies.filter(body=>{
      if (body.mass == 0) return false;
      var obj = body.renderer;
      if (obj.type == "Plane") return false;
      return true;
    });

    for (var body of this.bodies) {
      body.currentState = this.getPosQuat(body);
      body.previousState = body.currentState;
    }

    this.accumulatedTime = 0;
  }
  getPosQuat(body) {
    const actualPos = new CANNON.Vec3();
    if (body.shapeOffset) {
      body.quaternion.vmult(body.shapeOffset, actualPos);
      actualPos.set(body.position.x - actualPos.x, body.position.y - actualPos.y, body.position.z - actualPos.z);
    } else {
      actualPos.copy(body.position);
    }
    return {
      pos: [actualPos.x, actualPos.y, actualPos.z],
      quat: [body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w],
    };
  }
  stepPhysics(dt) {
    for (var body of this.bodies) {
      body.previousState = body.currentState;
    }
    this.world.step(dt);
    for (var body of this.bodies) {
      body.currentState = this.getPosQuat(body);
    }
    this.accumulatedTime += dt;
  }
  setTime(time,dt) {
    while (this.accumulatedTime < time) {
      this.stepPhysics(dt);
    }
    const startTime = this.accumulatedTime - dt;
    let alpha = (time - startTime) / dt;
    alpha = Math.max(0, Math.min(1, alpha));
    for (let body of this.bodies) {
      const obj = body.renderer;
      const prev = body.previousState;
      const current = body.currentState;

      vec3.lerp(obj.position, prev.pos, current.pos, alpha);
      quat.slerp(obj.rotation, prev.quat, current.quat, alpha);
      obj.updateMatrix();
    }
  }
  reset() {
    for (var i = 0; i < this.bodies.length; i++) {
      var body = this.bodies[i];
      var obj = body.renderer;
      var ot = body.initialTransform;
      obj.position = [ot.pos.x,ot.pos.y,ot.pos.z];
      obj.rotation = [ot.quat.x,ot.quat.y,ot.quat.z,ot.quat.w];
      obj.updateMatrix();
    }
    // note: does not reset physics sim, recommended to just make a new one
  }
}