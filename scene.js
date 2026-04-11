

var SelectedScene = 0; 
var SceneList = [
  {
    name: "Starter Box",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 1280;
      canvas.height = 720;
      var scene = new Scene(canvas);
      var cam = scene.camera;
      cam.lookAt(0,1,0);
      cam.setPosition(8.17,4.62,4.47);
      var mat = new Material("Material 1",[0.8,0.8,0.8],0.5);
      scene.newCube("Cube 1",mat,-1,0,-1,1,2,1);
      return scene;
    }
  },
  {
    name: "Rook & Diamond",
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
      
      var rookModel = new ModelData('RookModel').loadOBJ('assets/chess-rook.obj');
      var diamondModel = new ModelData('DiamondModel').loadOBJ('assets/diamond.obj');

      scene.background = new HDRTexture([0.8,0.85,1,1]);
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr');
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_greenhouse_2k.hdr','skybox');
      //scene.background = new HDRTexture('assets/cape_hill_4k.hdr');

      await Promise.all([
        woodTex.loaded, 
        normalTex.loaded, 
        dispTex.loaded, 
        rookModel.loaded,
        diamondModel.loaded,
        scene.background.loaded
      ]);
      rookModel.renormalize(true);
      rookModel.generateBVH();
      diamondModel.renormalize();
      diamondModel.generateBVH();

      var matWhite = new Material("White",[0.8, 0.8, 0.8], 1.0);
      var matLight = new Material("Light",[0.0, 0.0, 0.0], 1.0, {emissionIntensity: 15});

      var matRedGlass = new Material("Red Glass",[1.0, 0.2, 0.2], 0.0, {transmission: 1.0});
      
      scene.newPlane("Floor",matWhite, 0, 1, 0, 0);    // Floor (POM Textured)
      scene.newSphere("Light",matLight, 0, 3.5, 0, 0.5);

      var matDiamond = new Material("Diamond Material", [1.0, 1.0, 1.0], 0.0, { ior:2.4, transmission: 1.0 });
      var model = scene.newModel("Diamond",matDiamond,diamondModel,false).translate(0,1,0);
      model.icon = "💎";
      model.collider = new ConvexCollider();
      model.collider.hulls = [{
        verts: Array.from(diamondModel.vertex_positions),
        faces: Array.from(diamondModel.index_positions),
        offset: [0,0,0]
      }];
      scene.newModel("Rook",matRedGlass,rookModel,false).translate(-1,0,-1);
      
      scene.bounces = 10;

      return scene;
    }
  },
  {
    name: "Dragon & Bunny Mirror Room",
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
      
      var bunnyModel = new ModelData().loadOBJ('assets/bunny/model.obj');
      var dragonModel = new ModelData().loadOBJ('assets/dragon-2.obj');
      
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

      var matWhite = new Material("White",[0.8, 0.8, 0.8], 1.0);
      var matRed = new Material("Red",[0.8, 0.2, 0.2], 1.0);
      var matGreen = new Material("Green",[0.2, 0.8, 0.2], 1.0);
      var matCeramic = new Material("Ceramic",[0.9, 0.9, 0.9], 0.0);
      var matMetal = new Material("Mirror",[0.8, 0.9, 0.8], 0.0, {metallic:1});
      var matLight = new Material("Light",[0.0, 0.0, 0.0], 1.0, {emissionIntensity: 15});

      var matGlass = new Material("Glass",[1.0, 1.0, 1.0], 0.0, {transmission: 1.0});
      var matBlueGlass = new Material("Blue Frosted Glass",[0.2, 0.2, 1.0], 1.0, {transmission: 1.0});
      var matRedGlass = new Material("Red Glass",[1.0, 0.2, 0.2], 0.0, {transmission: 1.0});
      
      scene.newPlane("Floor",matCeramic, 0, 1, 0, 0);    // Floor (POM Textured)
      scene.newPlane("Ceiling",matWhite, 0, -1, 0, -3.5);   // Ceiling
      scene.newPlane("Back",matMetal, 0, 0, 1, -3.0);    // Back wall
      scene.newPlane("Front",matMetal, 0, 0, -1, -10.0);    // Front wall
      scene.newPlane("Left",matRed, 1, 0, 0, -2.5);      // Left wall
      scene.newPlane("Right",matGreen, -1, 0, 0, -2.5);   // Right wall

      scene.newSphere("Light",matLight, 0, 3.5, 0, 0.5);
      //scene.newSphere("Blue Ball",matBlueGlass, -1.6, 0.5, -1.4, 0.5);
      //scene.newSphere("Glass Ball",matGlass, 0, 0, 0, 2);

      var model = scene.newModel("Dragon",matBlueGlass,dragonModel);
      quat.rotateY(model.rotation, model.rotation, -20 * Math.PI / 180);
      model.scaleMult(1.5,1.5,1.5);
      var model2 = scene.newModel("Bunny",matCeramic,bunnyModel);
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

      var teapotModel = new ModelData("Teapot Model").loadOBJ('assets/teapot2.obj');
      var diamondModel = new ModelData("Diamond Model").loadOBJ('assets/diamond.obj');

      scene.background = new HDRTexture([0.8,0.85,1,1]);

      await Promise.all([teapotModel.loaded, diamondModel.loaded]);

      // Critical: Smooth the teapot to avoid faceted look
      teapotModel.renormalize(true);
      teapotModel.calculateSmoothNormals(true); 
      teapotModel.generateBVH();

      diamondModel.renormalize(true);
      diamondModel.generateBVH();

      var matGold = new Material("Gold", [1.0, 0.8, 0.3], 0.05, { metallic: 1.0 });
      var matDiamond = new Material("Diamond", [1.0, 1.0, 1.0], 0.0, { transmission: 1.0, ior: 2.4 });
      var matGlass = new Material("Glass", [0.9, 1.0, 0.9], 0.0, { transmission: 1.0, ior: 1.5 });
      var matFloor = new Material("Floor", [0.1, 0.1, 0.1], 0.2); // Dark glossy floor
      var matLight = new Material("Light", [0,0,0], 1, { emittance: [1, 0.9, 0.75], emissionIntensity: 20 });

      // Lights
      scene.newSphere("Top Light",matLight, 0, 5, 0, 0.5); // Top light
      scene.newSphere("Rim Light",matLight, 4, 2, 2, 0.2); // Rim light

      scene.newPlane("Floor",matFloor, 0, 1, 0, 0);

      // The Smooth Teapot
      var teapot = scene.newModel("Teapot",matGold, teapotModel);
      teapot.scaleMult(1.2, 1.2, 1.2);
      teapot.translate(0, 1, 0);

      // The Diamonds
      // scene.newModel("Diamond 1",matDiamond, diamondModel).translate(1.5, 0, 1);
      // scene.newModel("Diamond 2",matDiamond, diamondModel).translate(-1.5, 0, 1);

      // NEW FRUSTUM: Using it as a glass pedestal
      scene.newCylinder("Pedestal",matGlass).orient(0,0,0, 1, 0,1,0, 0.7);

      scene.bounces = 12;
      return scene;
    }
  },
  {
    name: "Random Objects",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 1024// * 3/4;
      canvas.height = 768// * 3/4;
      var scene = new Scene(canvas);
      
      // Position camera to look down at the circle
      //scene.camera.setPosition(0, 5, 6);
      //scene.camera.lookAt(0, 0, 0);
      var cam = scene.camera;
      cam.lookAt(0.678,-1.275,0.521);
      cam.setPosition(10.138,8.744,10.696);

      //scene.background = new HDRTexture([0.001,0.001,0.001,1]);
      scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr',"Venice Sunset");
      //scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_greenhouse_2k.hdr');

      var diamondModel = new ModelData("Diamond Model").loadOBJ('assets/diamond.obj');

      await Promise.all([
        scene.background.loaded,
        diamondModel.loaded
      ]);
      diamondModel.renormalize(true);
      diamondModel.generateBVH();

      // 1. Setup Materials
      var matGround = new Material("Ground Material", [0.1, 0.1, 0.1], 1.0); // Dark glossy floor
      var matLight = new Material("Light Material", [0, 0, 0], 1, { emissionIntensity: 15 });     // Overheard light
      
      // A function to get a random colorful material
      var index = 0;
      function getRandomMaterial() {
        const isEmissive = rng() < 0.2; 
        if (isEmissive) {
          const r = rng()*19+1;
          const g = rng()*19+1;
          const b = rng()*19+1;
          return new Material("Emissive "+index, [0, 0, 0], 1.0, { emittance: [r, g, b], emissionIntensity: 1.0 });
        }
        const types = [0, 1, 2]; // Diffuse, Metal, Glass
        const type = types[Math.floor(rng() * types.length)];
        const color = [rng(), rng(), rng()];
        const roughness = type != 0 && rng() < 0.3 ? 0 : rng();
        if (type == 0) {
          return new Material("Material "+index, color, roughness);
        } else if (type == 1) {
          return new Material("Material "+index, color, roughness, {
            metallic: 1.0,
          });
        } else if (type == 2) {
          return new Material("Material "+index, color, roughness, {
            transmission: 1.0,
          });
        }
      }

      // 2. Add Environment
      scene.newPlane("Ground", matGround, 0, 1, 0, 0); // Ground
      //scene.newSphere(matLight, 0, 10, 0, 1); // Sun/Light source
      
      // 3. Generate Non-Intersecting Spheres
      const spheres = [];
      const maxSpheres = 1000;
      const spawnRadius = 8.0;
      const minSize = 0.1;
      const maxSize = 0.4;

      let attempts = 0;
      var rng = mulberry32(42);
      while (spheres.length < maxSpheres && attempts < 5*maxSpheres) {
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
          index++;
          const mat = getRandomMaterial();
          var r = rng();
          if (r < 0.5) {
            scene.newSphere("Sphere "+index,mat, x, y, z, radius);
          } else if (r < 1) {
            scene.newCube("Cube "+index, mat, x-radius, y-radius, z-radius, x+radius, y+radius, z+radius);
          } else if (r < 0.6) {
            scene.newCylinder("Cylinder "+index, mat).orient(x, y-radius, z, radius, x, y+radius, z, radius);
          } else if (r < 0.8) {
            scene.newTorus("Torus "+index, mat, radius*0.75,radius*0.25).translate(x,y-radius*0.5,z);
          } else {
            scene.newModel("Diamond "+index, mat, diamondModel,true).translate(x,y-radius,z).scaleMult(radius,radius,radius);
          }
          // Store metadata for the next collision check
          spheres.push({ x, y, z, radius });
        }
      }

      var heavyMat = new Material("Heavy", [0.8,0.8,0.8], 1, {
        density: 50,
      });
      var heavyBall = scene.newSphere("Heavy Ball", heavyMat, 0, 1, -11, 1);
      heavyBall.velocity[2] = 30;
      heavyBall.angularVelocity[0] = 30;

      //scene.newModel(matGround,diamondModel,true);

      scene.bounces = 6;
      return scene;
    }
  },
  {
    name: "Bunny",
    load: async function() {},
    create: async function(canvas) {
      canvas.width = 400;
      canvas.height = 304;
      // canvas.width = 1024;
      // canvas.height = 768;
      
      var scene = new Scene(canvas);

      //var cam = scene.camera;
      //cam.lookAt(0,0.5,0);
      //cam.setPosition(0,0,4.5);
      
      // Preload our new textures
      // var woodTex = new Texture('https://i.ibb.co/0RnQ8mp0/wood.png');
      // var normalTex = new Texture('https://i.ibb.co/dJzqsKry/normal.png');
      // var dispTex = new Texture('https://i.ibb.co/0ywvFnyh/disp.png');

      var bunnyModel = new ModelData('Bunny').loadOBJ('assets/bunny/model.obj');
      var bunnyColor = new Texture('assets/bunny/color.jpg','Bunny Color');
      var bunnyNormal = new Texture('assets/bunny/normal.png', 'Bunny Normals');
      var bunnyRoughness = new Texture('assets/bunny/roughness.jpeg', 'Bunny Roughness');

      scene.background = new HDRTexture('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr','Venice Sunset');
      
      await Promise.all([
        // woodTex.loaded, 
        // normalTex.loaded, 
        // dispTex.loaded, 
        bunnyModel.loaded,
        bunnyColor.loaded,
        bunnyNormal.loaded,
        bunnyRoughness.loaded,
        scene.background.loaded
      ]);
      bunnyModel.renormalize();
      bunnyModel.generateBVH();

      var matWhite = new Material("White",[0.8, 0.8, 0.8], 1.0);
      var matLight = new Material("Light",[0.0, 0.0, 0.0], 1.0, {emissionIntensity: 15});

      // Set up the robust POM material!
      // var toyBox = new Material("Toy Box",0,[1.0, 1.0, 1.0], 0.5, [0, 0, 0], {
      //   albedoTex: woodTex,
      //   normalTex: normalTex,
      //   heightTex: dispTex,
      //   uvScale: [1.0, 1.0], // Scale of the texture on the plane
      //   normalMultiplier: 1,
      //   heightMultiplier: 0.15, // Positive means Depth Map (white=deep). Negative means Height Map (white=high).
      //   heightSamp: 32,      // Number of raymarch steps
      //   heightOffset: 0    // Shifts where the surface starts
      // });

      scene.newPlane("Floor",matWhite, 0, 1, 0, 0);    // Floor (POM Textured)
      scene.newSphere("Light",matLight, 0, 3.5, 0, 0.5);

      var bunnyMaterial = new Material("Bunny Material",[1.0, 1.0, 1.0], 0.5, {
        albedoTex: bunnyColor,
        normalTex: bunnyNormal,
        roughnessTex: bunnyRoughness,
        uvScale: [1.0, -1.0],
      });

      var model2 = scene.newModel("Bunny",bunnyMaterial,bunnyModel);
      model2.scaleMult(0.5,0.5,0.5);
      model2.translate(-1,0.5,1);

      //let box = scene.newCube("Toy Box",toyBox, 0.2, 0.4, -0.2, 1.0, 1.2, 0.6);
      //quat.setAxisAngle(box.rotation, [0, 1, 0], -20 * Math.PI / 180); 
      //box.updateMatrix();

      scene.bounces = 10;

      return scene;
    }
  },
  // {
  //   name: "Material Test",
  //   load: async function() {},
  //   create: async function(canvas) {
  //     canvas.width = 512;
  //     canvas.height = 512;

  //     const loader = new GLBLoader();
  //     var scene = new Scene(canvas);

  //     const { models } = await loader.load('assets/material_ball.glb');
  //     models[0].bakeTransform(mat4.fromRotation(mat4.create(), -Math.PI / 2, [1, 0, 0]));
  //     models[0].renormalize(true);
  //     models[0].generateBVH();
      
  //     scene.objects = scene.objects.concat(models);
  //   },
  // }
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

async function loadScene() {
  SelectedScene = Number(prompt("Enter a scene number (0-5)")) || 0;
  if (!confirm("Loading "+SceneList[SelectedScene].name+"\nThis will override the current scene, do you wish to continue?")) return;
  if (SceneList[SelectedScene].load) await SceneList[SelectedScene].load();
  const canvas = document.getElementById('gpuCanvas');
  var scene = await SceneList[SelectedScene].create(canvas);
  document.getElementById('render-w').value = canvas.width;
  document.getElementById('render-h').value = canvas.height;
  document.getElementById('render-bounces').value = scene.bounces;
  State.scene = scene;
  Cam.updateOrbit(scene.camera.position,scene.camera.target);
  State.nodes = scene.objects;
  //State.nodes.unshift(); // add camera

  State.assets = [];
  if (scene.background) {
    var data = scene.background.data;
    if (data.length == 4) {
      State.backgroundColor = [data[0],data[1],data[2]];
      State.backgroundIntensity = 1;
      State.background = null;
    } else {
      State.backgroundColor = [1,1,1];
      State.backgroundIntensity = 1;
      State.background = scene.background;
      State.assets.push(State.background);
    }
  }

  var materials = scene.getMaterials();
  materials.forEach(m=>{
    var max = Math.max(...m.emittance);
    if (max < 1) return;
    m.emittance = m.emittance.map(v=>v/max);
    m.emissionIntensity *= max;
  });
  State.assets = State.assets.concat(materials);
  State.assets = State.assets.concat(scene.getTextures());
  const uniqueModels = [];
  scene.objects.forEach(obj => {
    if (obj.type != "Model") return;
    if (uniqueModels.includes(obj.model)) return;
    uniqueModels.push(obj.model);
  });
  State.assets = State.assets.concat(uniqueModels);

  renderList();
  renderInspector();
  renderAssets();
  //
	AnimationPanel.reset();
  AnimationPanel.updateUI();
  AnimationPanel.render();
  AnimationPanel.updateSeeker();
}

/*var renderer;
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

init();*/


