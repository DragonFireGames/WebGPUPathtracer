// Animation panel state and functions
const AnimationPanel = {
  items: new Map(), // Map of node id -> node name
  keyframes: new Map(), // Map of node id -> array of {time, position, rotation, scale}
  isPlaying: false,
  currentTime: 0, // in seconds
  duration: 60, // 1:00
  lastFrameTime: 0,
  animationFrameId: null,

  reset() {
    this.items = new Map();
    this.keyframes = new Map();
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 60;
    this.lastFrameTime = 0;
    this.animationFrameId = null;
  },

  addItem(nodeId, nodeName) {
    if (!this.items.has(nodeId)) {
      this.items.set(nodeId, nodeName);
      this.keyframes.set(nodeId, []);
      this.render();
      this.updateSeeker();
    }
  },

  removeItem(nodeId) {
    this.items.delete(nodeId);
    this.keyframes.delete(nodeId);
    this.render();
    this.updateSeeker();
  },

  insertKeyframe(nodeId) {
    const node = State.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Add item to animation if it doesn't exist
    if (!this.items.has(nodeId)) {
      this.addItem(nodeId, node.name);
    }

    const keyframes = this.keyframes.get(nodeId) || [];
    const newKeyframe = {
      time: this.currentTime,
      position: [...node.position],
      rotation: [...node.rotation],
      scale: [...node.scale],
      easing: "linear",
    };

    // Remove existing keyframe at this time if it exists
    const existingIndex = keyframes.findIndex(
      (k) => Math.abs(k.time - this.currentTime) < 0.01,
    );
    if (existingIndex !== -1) {
      keyframes[existingIndex] = newKeyframe;
    } else {
      keyframes.push(newKeyframe);
      keyframes.sort((a, b) => a.time - b.time);
    }

    this.keyframes.set(nodeId, keyframes);
    this.render();
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

  updateUI() {
    // Update time display
    const minutes = Math.floor(this.currentTime / 60);
    const seconds = Math.floor(this.currentTime % 60);
    const display = `${minutes}:${seconds.toString().padStart(2, "0")} / 1:00`;
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
    const fn =
      this.easingFunctions[easingType] || this.easingFunctions.linear;
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

      const node = State.nodes.find((n) => n.id === nodeId);
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
        quat.lerp(node.rotation,kf1.rotation,kf2.rotation,t);
        quat.normalize(node.rotation,node.rotation);
        vec3.lerp(node.scale,kf1.scale,kf2.scale,t);
      } else if (kf1 && !kf2 || kf1 === kf2) {
        // Use the last keyframe
        node.position = [...kf1.position];
        node.rotation = [...kf1.rotation];
        node.scale = [...kf1.scale];
      } else if (!kf1 && kf2) {
        // Use the first keyframe
        node.position = [...kf2.position];
        node.rotation = [...kf2.rotation];
        node.scale = [...kf2.scale];
      }
      node.updateMatrix();
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

class PhysicsController {
  constructor(objects) {
    var world = this.world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.solver.iterations = 20;
    world.defaultContactMaterial.contactEquationStiffness = 1e10;
    world.defaultContactMaterial.contactEquationRelaxation = 10;

    this.bodies = [];
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      //if (!(obj instanceof TracerObject)) continue;
      var pos = {x:obj.position[0],y:obj.position[1],z:obj.position[2]};
      var quat = {x:obj.rotation[0],y:obj.rotation[1],z:obj.rotation[2],w:obj.rotation[3]};
      var scale = {x:obj.scale[0],y:obj.scale[1],z:obj.scale[2]};
      
      var body;
      var density = 5;
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
      } else {
        alert("Physics for "+obj.type+" aren't supported yet.");
        continue;
      }

      body.position.set(pos.x, pos.y, pos.z);
      body.quaternion.set(quat.x, quat.y, quat.z, quat.w);

      world.addBody(body);
      body.renderer = obj;
      body.scale = scale;
      body.initialTransform = { pos, quat };
      obj.physicsbody = body;

      this.bodies.push(body);
    }
  }
  update(deltaTime) {
    this.world.step(deltaTime);
    for (var i = 0; i < this.bodies.length; i++) {
      var body = this.bodies[i];
      if (body.mass == 0) continue;
      var obj = body.renderer;
      if (obj.type == "Plane") continue;
      //var T = Wugl.composeTransform3D(body.position, body.quaternion, body.scale); 
      //if (body.offset) T = T.multiply(Transform.Translation([ -body.offset.x, -body.offset.y, -body.offset.z ])); 
      //obj.setTransform(T);
      obj.position = [body.position.x,body.position.y,body.position.z];
      obj.rotation = [body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w];
      obj.updateMatrix();
    }
  }
  reset() {
    for (var i = 0; i < this.bodies.length; i++) {
      var body = this.bodies[i];
      if (body.mass == 0) continue;
      var obj = body.renderer;
      if (obj.type == "Plane") continue;
      //var T = Wugl.composeTransform3D(body.position, body.quaternion, body.scale); 
      //if (body.offset) T = T.multiply(Transform.Translation([ -body.offset.x, -body.offset.y, -body.offset.z ])); 
      //obj.setTransform(T);
      var ot = body.initialTransform;
      console.log(ot);
      obj.position = [ot.pos.x,ot.pos.y,ot.pos.z];
      obj.rotation = [ot.quat.x,ot.quat.y,ot.quat.z,ot.quat.w];
      obj.updateMatrix();
    }
  }
}
