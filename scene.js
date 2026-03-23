

var SelectedScene = Number(prompt("Enter a scene number (0-3)")) || 0;
var SceneList = [
  {
    name: "POM & Normals Box",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 400;
      canvas.height = 304;
      // canvas.width = 1024;
      // canvas.height = 768;

      var scene = new Scene(canvas);

      var cam = scene.camera;
      //cam.lookAt(0,0.5,0);
      //cam.setPosition(0,0,4.5);
      
      // Preload our new textures
      var woodTex = new Texture('https://i.ibb.co/0RnQ8mp0/wood.png');
      var normalTex = new Texture('https://i.ibb.co/dJzqsKry/normal.png');
      var dispTex = new Texture('https://i.ibb.co/0ywvFnyh/disp.png');

      // var bunnyModel = new ModelData('assets/bunny/model.obj');
      // var bunnyColor = new Texture('assets/bunny/color.jpg');
      // var bunnyNormal = new Texture('assets/bunny/normal.png');

      // var dragonModel = new ModelData('assets/dragon-2.obj');
      var rookModel = new ModelData('assets/chess-rook.obj');
      var diamondModel = new ModelData('assets/diamond.obj');

      scene.background = new HDRTexture([0.8,0.85,1,1]);
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_greenhouse_2k.hdr');
      //scene.background = new HDRTexture('assets/cape_hill_4k.hdr');

      await Promise.all([
        woodTex.loaded, 
        normalTex.loaded, 
        dispTex.loaded, 
        // bunnyModel.loaded,
        // bunnyColor.loaded,
        // bunnyNormal.loaded,
        rookModel.loaded,
        diamondModel.loaded,
        // dragonModel.loaded,
        //scene.background.loaded
      ]);
      // bunnyModel.renormalize();
      // bunnyModel.generateBVH();
      // const rot = mat4.create();
      // mat4.fromXRotation(rot, -Math.PI / 2);
      // dragonModel.bakeTransform(rot);
      // dragonModel.renormalize(true);
      // dragonModel.calculateSmoothNormals();
      // dragonModel.generateBVH();
      //
      rookModel.renormalize(true);
      rookModel.generateBVH();
      diamondModel.renormalize(true);
      diamondModel.generateBVH();

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

      scene.newPlane(matWhite, 0, 1, 0, 0);    // Floor (POM Textured)
      // scene.newPlane(matWhite, 0, -1, 0, -3.5);   // Ceiling
      // scene.newPlane(matWhite, 0, 0, 1, -3.0);    // Back wall
      // scene.newPlane(matWhite, 0, 0, -1, -10.0);    // Front wall
      // scene.newPlane(matRed, 1, 0, 0, -2.5);      // Left wall
      // scene.newPlane(matGreen, -1, 0, 0, -2.5);   // Right wall
      
      scene.newSphere(matLight, 0, 3.5, 0, 0.5);
      //scene.newSphere(matBlueGlass, -1.6, 0.5, -1.4, 0.5);
      //scene.newSphere(matGlass, 0, 0, 0, 2);

      // var bunnyMaterial = new Material(0,[1.0, 1.0, 1.0], 0.5, [0, 0, 0], {
      //   albedoTex: bunnyColor,
      //   normalTex: bunnyNormal,
      //   uvScale: [1.0, -1.0],
      // });
      
      // var model = scene.newModel(matDiamond,dragonModel);
      //model.translate(0,1,0);

      var matDiamond = new Material(2,[1.0, 1.0, 1.0], 0.0, [0, 0, 0],{ior:2.4});
      var model = scene.newModel(matDiamond,diamondModel);
      scene.newModel(matRedGlass,rookModel).translate(-1,0,-1);

      //var t = scene.newTorus(matRedGlass,0.5);
      //t.translate(0,1,0);
      //scene.newFrustum(matRedGlass).orient(-1.5,0,-1,0.2,-1.5,1,-1,0.2)

      // var model2 = scene.newModel(matCeramic,bunnyModel);
      // model2.scaleMult(0.5,0.5,0.5);
      // model2.translate(-1,0.5,1);

      //let box = scene.newCube(toyBox, 0.2, 0.4, -0.2, 1.0, 1.2, 0.6);
      //quat.setAxisAngle(box.rotation, [0, 1, 0], -20 * Math.PI / 180); 
      //box.updateMatrix();

      scene.bounces = 10;

      return scene;
    }
  },
  {
    name: "POM & Normals Box",
    load: async function() {},
    create: async function(canvas) {
      // canvas.width = 400;
      // canvas.height = 304;
      canvas.width = 1024;
      canvas.height = 768;

      var scene = new Scene(canvas);

      var cam = scene.camera;
      cam.lookAt(0,1,-0.5);
      cam.setPosition(-1.45,2.25,5);
      cam.fixed = true;
      
      var bunnyModel = new ModelData('assets/bunny/model.obj');
      var dragonModel = new ModelData('assets/dragon-2.obj');
      
      //scene.background = new HDRTexture([0.8,0.85,1,1]);
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_greenhouse_2k.hdr');
      //scene.background = new HDRTexture('assets/cape_hill_4k.hdr');

      await Promise.all([
        bunnyModel.loaded,
        dragonModel.loaded,
        //scene.background.loaded
      ]);
      bunnyModel.renormalize();
      bunnyModel.generateBVH();
      // const rot = mat4.create();
      // mat4.fromXRotation(rot, -Math.PI / 2);
      // dragonModel.bakeTransform(rot);
      dragonModel.renormalize(true);
      dragonModel.calculateSmoothNormals();
      dragonModel.generateBVH();
      //

      var matWhite = new Material(0,[0.8, 0.8, 0.8], 1.0, [0, 0, 0]);
      var matRed = new Material(0,[0.8, 0.2, 0.2], 1.0, [0, 0, 0]);
      var matGreen = new Material(0,[0.2, 0.8, 0.2], 1.0, [0, 0, 0]);
      var matCeramic = new Material(0,[0.9, 0.9, 0.9], 0.0, [0, 0, 0]);
      var matMetal = new Material(1,[0.8, 0.9, 0.8], 0.0, [0, 0, 0]);
      var matLight = new Material(0,[0.0, 0.0, 0.0], 1.0, [15, 15, 15]);

      var matGlass = new Material(2,[1.0, 1.0, 1.0], 0.0, [0, 0, 0]);
      var matBlueGlass = new Material(2,[0.2, 0.2, 1.0], 1.0, [0, 0, 0]);
      var matRedGlass = new Material(2,[1.0, 0.2, 0.2], 0.0, [0, 0, 0]);
      var matUraniumGlass = new Material(2,[0.4, 1.0, 0.4], 0.0, [0, 0.01, 0]);

      scene.newPlane(matCeramic, 0, 1, 0, 0);    // Floor (POM Textured)
      scene.newPlane(matWhite, 0, -1, 0, -3.5);   // Ceiling
      scene.newPlane(matMetal, 0, 0, 1, -3.0);    // Back wall
      scene.newPlane(matMetal, 0, 0, -1, -6.0);    // Front wall
      scene.newPlane(matRed, 1, 0, 0, -2.5);      // Left wall
      scene.newPlane(matGreen, -1, 0, 0, -2.5);   // Right wall
      
      scene.newSphere(matLight, 0, 3.5, 0, 0.5);
      //scene.newSphere(matBlueGlass, -1.6, 0.5, -1.4, 0.5);
      //scene.newSphere(matGlass, 0, 0, 0, 2);

      var model = scene.newModel(matBlueGlass,dragonModel);
      quat.rotateY(model.rotation, model.rotation, -20 * Math.PI / 180);
      model.scaleMult(1.5,1.5,1.5);
      var model2 = scene.newModel(matCeramic,bunnyModel);
      model2.scaleMult(0.5,0.5,0.5);
      model2.translate(-1,0.5,1);

      scene.bounces = 24;

      return scene;
    }
  },
  {
    name: "Glass & Geometry Study",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 800;
      canvas.height = 608;
      var scene = new Scene(canvas);
      
      var cam = scene.camera;
      cam.setPosition(3, 2.5, 5);
      cam.lookAt(0, 0.8, 0);

      var teapotModel = new ModelData('assets/teapot2.obj');
      var diamondModel = new ModelData('assets/diamond.obj');

      scene.background = new HDRTexture([0.8,0.85,1,1]);

      await Promise.all([teapotModel.loaded, diamondModel.loaded]);

      // Critical: Smooth the teapot to avoid faceted look
      teapotModel.renormalize(true);
      teapotModel.calculateSmoothNormals(true); 
      teapotModel.generateBVH();

      diamondModel.renormalize(true);
      diamondModel.generateBVH();

      var matGold = new Material(1, [1.0, 0.8, 0.3], 0.05, [0, 0, 0]);
      var matDiamond = new Material(2, [1.0, 1.0, 1.0], 0.0, [0, 0, 0], { ior: 2.4 });
      var matGlass = new Material(2, [0.9, 1.0, 0.9], 0.0, [0, 0, 0], { ior: 1.5 });
      var matFloor = new Material(0, [0.1, 0.1, 0.1], 0.2, [0, 0, 0]); // Dark glossy floor
      var matLight = new Material(0, [0,0,0], 1, [20, 18, 15]);

      // Lights
      scene.newSphere(matLight, 0, 5, 0, 0.5); // Top light
      scene.newSphere(matLight, 4, 2, 2, 0.2); // Rim light

      scene.newPlane(matFloor, 0, 1, 0, 0);

      // The Smooth Teapot
      var teapot = scene.newModel(matGold, teapotModel);
      teapot.scaleMult(1.2, 1.2, 1.2);
      teapot.translate(0, 1, 0);

      // The Diamonds
      // scene.newModel(matDiamond, diamondModel).translate(1.5, 0, 1);
      // scene.newModel(matDiamond, diamondModel).translate(-1.5, 0, 1);

      // NEW FRUSTUM: Using it as a glass pedestal
      scene.newFrustum(matGlass).orient(0,0,0, 1, 0,1,0, 0.7);

      scene.bounces = 12;
      return scene;
    }
  },
  {
    name: "Random Sphere Forest",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 1024;
      canvas.height = 768;
      var scene = new Scene(canvas);
      
      // Position camera to look down at the circle
      scene.camera.setPosition(0, 5, 6);
      scene.camera.lookAt(0, 0, 0);

      //scene.background = new HDRTexture([0.04,0.04,0.04,1]);
      scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_greenhouse_2k.hdr');
      await Promise.resolve(scene.background.loaded);

      // 1. Setup Materials
      var matGround = new Material(0, [0.1, 0.1, 0.1], 0.1, [0, 0, 0]); // Dark glossy floor
      var matLight = new Material(0, [0, 0, 0], 1, [15, 15, 15]);     // Overheard light
      
      // A function to get a random colorful material
      function getRandomMaterial() {
        const isEmissive = rng() < 0.15; 
        if (isEmissive) {
          const r = rng()*19+1;
          const g = rng()*19+1;
          const b = rng()*19+1;
          return new Material(0, [0, 0, 0], 1.0, [r, g, b]);
        }
        const types = [0, 1, 2]; // Diffuse, Metal, Glass
        const type = types[Math.floor(rng() * types.length)];
        const color = [rng(), rng(), rng()];
        const roughness = type != 0 && rng() < 0.3 ? 0 : rng();
        return new Material(type, color, roughness, [0, 0, 0]);
      }


      // 2. Add Environment
      scene.newPlane(matGround, 0, 1, 0, 0); // Ground
      //scene.newSphere(matLight, 0, 10, 0, 1); // Sun/Light source
      
      // 3. Generate Non-Intersecting Spheres
      const spheres = [];
      const maxSpheres = 40;
      const spawnRadius = 2.0;
      const minSize = 0.1;
      const maxSize = 0.4;

      let attempts = 0;
      var rng = mulberry32(42);
      while (spheres.length < maxSpheres && attempts < 1000) {
        attempts++;
        
        // Random position in a circle (Polar coordinates)
        const angle = rng() * Math.PI * 2;
        const dist = Math.sqrt(rng()) * spawnRadius;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        const radius = minSize + rng() * (maxSize - minSize);
        const y = radius; // Sit exactly on the ground

        // Check for intersections
        let collision = false;
        for (let s of spheres) {
          const dx = x - s.x;
          const dy = y - s.y;
          const dz = z - s.z;
          const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
          
          // If distance is less than sum of radii, they overlap
          if (distance < (radius + s.radius + 0.05)) { // 0.05 buffer
            collision = true;
            break;
          }
        }

        if (!collision) {
          const mat = getRandomMaterial();
          const sphereObj = scene.newSphere(mat, x, y, z, radius);
          // Store metadata for the next collision check
          spheres.push({ x, y:y, z, radius });
        }
      }

      scene.bounces = 6;
      return scene;
    }
  }
];

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
    if (cam.fixed) return;
    vec3.set(cam.position, 
      zoom * Math.cos(angleX) * Math.sin(angleY) + cam.lookingat[0], 
      zoom * Math.sin(angleX) + cam.lookingat[1],
      zoom * Math.cos(angleX) * Math.cos(angleY) + cam.lookingat[2]
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


