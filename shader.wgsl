@id(0) override BOUNCE_LIMIT: i32 = 8;
@id(1) override HAS_SPHERES: bool = true;
@id(2) override HAS_CUBES: bool = true;
@id(3) override HAS_PLANES: bool = true;
@id(4) override HAS_CYLINDERS: bool = true;
@id(5) override HAS_TORI: bool = true;
@id(6) override HAS_MESHES: bool = true;
@id(7) override HAS_LIST_MESHES: bool = true;
@id(8) override HAS_HEIGHTMAPS: bool = true;
@id(9) override HAS_SKYBOX: bool = true;

struct Ray {
  origin: vec3f,
  direction: vec3f
};
struct SceneParams {
  frame_count: u32, width: u32, height: u32, exposure: f32,
  eye: vec4f, ray00: vec4f, ray10: vec4f, ray01: vec4f, ray11: vec4f 
};

struct Material { 
  albedo: vec3f,
  roughness: f32, 
  emittance: vec3f,
  material_type: i32,
  // Integer Texture IDs
  albedo_idx: i32,
  normal_idx: i32,
  height_idx: i32,
  roughness_idx: i32,
  uv_scale: vec2f,
  ior: f32,
  concentration: f32,
  // Height Params
  height_params: vec4f  // x: norm_mult, y: multiplier, z: samples, w: offset
};

struct TransformedObject { 
  inv_matrix: mat4x4f,
  material_idx: i32,
  object_type: i32,
  pad0: f32, pad1: f32
};

struct Plane { 
  normal: vec3f,
  d: f32,
  material_idx: i32,
  pad0: f32, pad1: f32, pad2: f32
};

struct Cylinder { 
  inv_matrix: mat4x4f,
  material_idx: i32,
  top_radius: f32,
};

struct Torus { 
  inv_matrix: mat4x4f,
  material_idx: i32,
  inner_radius: f32,
};

struct Triangle {
  v0: vec3f, pad0: f32,
  v1: vec3f, pad1: f32,
  v2: vec3f, pad2: f32,
  n0: vec3f, pad3: f32,
  n1: vec3f, pad4: f32,
  n2: vec3f, pad5: f32,
  uv0: vec2f, uv1: vec2f, uv2: vec2f, pad6: vec2f
};

struct MeshInstance {
  inv_matrix: mat4x4f,
  material_idx: i32,
  pad: i32,
  node_offset: u32,
  tri_offset: u32,
};

struct BVHNode {
  aabb_min: vec3f,
  num_triangles: u32,
  aabb_max: vec3f,
  next: u32, // right child or triangle start index
};

struct SurfaceHit {
  t: f32, m_idx: i32,
  hit_p: vec3f, hit_n: vec3f, hit_uv: vec2f,
  tangent: vec3f, bitangent: vec3f,
  count: i32,
};

@group(0) @binding(0) var<uniform> params: SceneParams;
@group(0) @binding(1) var<storage, read_write> accum_buffer: array<vec4f>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> materials: array<Material>;
@group(0) @binding(4) var<storage, read> objects: array<TransformedObject>;
@group(0) @binding(5) var<storage, read> tlas_nodes: array<BVHNode>;
@group(0) @binding(6) var<storage, read> meshes: array<MeshInstance>;
@group(0) @binding(7) var<storage, read> bvh_nodes: array<BVHNode>;
@group(0) @binding(8) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(9) var<storage, read> planes: array<Plane>;

// 8 Texture Bindings for rich materials
@group(0) @binding(10) var t0: texture_2d<f32>;
@group(0) @binding(11) var t1: texture_2d<f32>;
@group(0) @binding(12) var t2: texture_2d<f32>;
@group(0) @binding(13) var t3: texture_2d<f32>;
@group(0) @binding(14) var t4: texture_2d<f32>;
@group(0) @binding(15) var t5: texture_2d<f32>;
@group(0) @binding(16) var t6: texture_2d<f32>;
@group(0) @binding(17) var t7: texture_2d<f32>;
@group(0) @binding(18) var texture_sampler: sampler;

// skybox
@group(0) @binding(19) var skyTex: texture_2d<f32>;
@group(0) @binding(20) var skySampler: sampler;

var<private> rng_state: u32;
fn rand_pcg() -> f32 {
  let state = rng_state;
  rng_state = state * 747796405u + 2891336453u;
  var word: u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  word = (word >> 22u) ^ word;
  return f32(word) / 4294967296.0;
}

fn random_unit_vector() -> vec3f {
  let z = rand_pcg() * 2.0 - 1.0;
  let a = rand_pcg() * 2.0 * 3.14159265358979;
  let r = sqrt(1.0 - z * z);
  return vec3f(r * cos(a), r * sin(a), z);
}

fn sample_texture(idx: i32, uv: vec2f) -> vec4f {
  let nuv = vec2f(uv.x,uv.y);
  if (idx == 0) { return textureSampleLevel(t0, texture_sampler, nuv, 0.0); }
  else if (idx == 1) { return textureSampleLevel(t1, texture_sampler, nuv, 0.0); }
  else if (idx == 2) { return textureSampleLevel(t2, texture_sampler, nuv, 0.0); }
  else if (idx == 3) { return textureSampleLevel(t3, texture_sampler, nuv, 0.0); }
  else if (idx == 4) { return textureSampleLevel(t4, texture_sampler, nuv, 0.0); }
  else if (idx == 5) { return textureSampleLevel(t5, texture_sampler, nuv, 0.0); }
  else if (idx == 6) { return textureSampleLevel(t6, texture_sampler, nuv, 0.0); }
  else if (idx == 7) { return textureSampleLevel(t7, texture_sampler, nuv, 0.0); }
  return vec4f(1.0);
}

// WGSL function to sample the sky
fn sample_sky(dir: vec3f) -> vec3f {
  let pi = 3.14159265359;
  
  // Convert direction to spherical coordinates
  let phi = atan2(dir.z, dir.x);      // -PI to PI
  let theta = asin(clamp(dir.y, -1.0, 1.0)); // -PI/2 to PI/2
  
  // Map to 0.0 - 1.0 range
  let u = 0.5 + phi / (2.0 * pi);
  let v = 0.5 - theta / pi;
  
  // Sample your texture (assuming it's in a binding called 'skyTex')
  // We use a sampler with linear filtering for smooth skies
  return textureSampleLevel(skyTex, skySampler, vec2f(u, v), 0.0).rgb;
}

fn intersect_aabb(origin: vec3f, inv_dir: vec3f, aabb_min: vec3f, aabb_max: vec3f) -> f32 {
  let t0 = (aabb_min - origin) * inv_dir;
  let t1 = (aabb_max - origin) * inv_dir;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let t_near = max(max(tmin.x, tmin.y), tmin.z);
  let t_far = min(min(tmax.x, tmax.y), tmax.z);
  if (t_near > t_far || t_far < 0.0) { return -1.; }//{ return 9999999.0; }
  return select(t_near, 0.0, t_near < 0.0);
}

fn intersect_triangle(ray: Ray, tri: Triangle, hit_t: ptr<function, f32>, hit_uv: ptr<function, vec2f>, bary: ptr<function, vec3f>) -> bool {
  let edge1 = tri.v1 - tri.v0;
  let edge2 = tri.v2 - tri.v0;
  let h = cross(ray.direction, edge2);
  let a = dot(edge1, h);
  if (abs(a) < 0.000001) { return false; } 
  let f = 1.0 / a;
  let s = ray.origin - tri.v0;
  let u = f * dot(s, h);
  if (u < 0.0 || u > 1.0) { return false; }
  let q = cross(s, edge1);
  let v = f * dot(ray.direction, q);
  if (v < 0.0 || u + v > 1.0) { return false; }
  let t = f * dot(edge2, q);
  if (t > 0.000001) {
    *hit_t = t;
    *bary = vec3f(1.0 - u - v, u, v);
    *hit_uv = tri.uv0 * bary.x + tri.uv1 * bary.y + tri.uv2 * bary.z;
    return true;
  }
  return false;
}

fn trace_mesh(ray_world: Ray, mesh: MeshInstance, hit: ptr<function, SurfaceHit>) {
  // Transform ray into local space. Do not normalize direction to keep t identical!
  var ray_local: Ray;
  ray_local.origin = (mesh.inv_matrix * vec4f(ray_world.origin, 1.0)).xyz;
  ray_local.direction = (mesh.inv_matrix * vec4f(ray_world.direction, 0.0)).xyz;
  
  let inv_dir = 1.0 / ray_local.direction;
  var stack: array<u32, 64>; 
  var stack_ptr: i32 = 0;
  
  stack[0] = mesh.node_offset; // Start at root node for this mesh
  stack_ptr++;
  let base_t = intersect_aabb(ray_local.origin, inv_dir, bvh_nodes[mesh.node_offset].aabb_min, bvh_nodes[mesh.node_offset].aabb_max);
  if (base_t < 0. || base_t >= (*hit).t) {return;}

  while (stack_ptr > 0) {
    (*hit).count++;
    stack_ptr--;
    let node_idx = stack[stack_ptr];
    let node = bvh_nodes[node_idx];

    //let t_aabb = intersect_aabb(ray_local.origin, inv_dir, node.aabb_min, node.aabb_max);
    //if (t_aabb < 0. || t_aabb >= (*hit).t) { continue; }

    if (node.num_triangles > 0u) {
      // Leaf
      let start = mesh.tri_offset + node.next;
      let end = start + node.num_triangles;
      for (var i = start; i < end; i++) {
        let tri = triangles[i];
        var t_tri = 0.0;
        var uv_tri = vec2f(0.0);
        var bary = vec3f(0.0);
        
        if (intersect_triangle(ray_local, tri, &t_tri, &uv_tri, &bary)) {
          if (t_tri < (*hit).t) {
            (*hit).t = t_tri;
            (*hit).m_idx = mesh.material_idx;
            
            // Need local hit and normal, transform back to world space
            let local_hit = ray_local.origin + ray_local.direction * t_tri;
            let local_norm = normalize(tri.n0 * bary.x + tri.n1 * bary.y + tri.n2 * bary.z);
            
            (*hit).hit_p = ray_world.origin + ray_world.direction * t_tri;
            
            // Transform normal: transpose of inverse (which is just inv_matrix transposed)
            // Inverse transpose is used for normals when non-uniform scaling occurs
            let world_norm = transpose(mesh.inv_matrix) * vec4f(local_norm, 0.0);
            (*hit).hit_n = normalize(world_norm.xyz);
            (*hit).hit_uv = uv_tri;
          }
        }
      }
    } else {
      // Inner Node
      let left_idx = node_idx + 1u;
      let right_idx = mesh.node_offset + node.next;
      let left_t = intersect_aabb(ray_local.origin, inv_dir, bvh_nodes[left_idx].aabb_min, bvh_nodes[left_idx].aabb_max);
      let right_t = intersect_aabb(ray_local.origin, inv_dir, bvh_nodes[right_idx].aabb_min, bvh_nodes[right_idx].aabb_max);
      if (left_t < right_t) {
        if (right_t >= 0. && right_t < (*hit).t) { stack[stack_ptr] = right_idx; stack_ptr++; }
        if (left_t >= 0. && left_t < (*hit).t) { stack[stack_ptr] = left_idx; stack_ptr++; }
      } else {
        if (left_t >= 0. && left_t < (*hit).t) { stack[stack_ptr] = left_idx; stack_ptr++; }
        if (right_t >= 0. && right_t < (*hit).t) { stack[stack_ptr] = right_idx; stack_ptr++; }
      }
    }
  }
}

fn hit_unit_sphere(r: Ray) -> f32 {
  let a = dot(r.direction, r.direction);
  let half_b = dot(r.origin, r.direction);
  let c = dot(r.origin, r.origin) - 1.0;
  let discriminant = half_b * half_b - a * c;
  if (discriminant < 0.0) { return -1.0; }
  let sqrtd = sqrt(discriminant);
  var root = (-half_b - sqrtd) / a;
  if (root < 0.001) { root = (-half_b + sqrtd) / a; }
  return select(-1.0, root, root >= 0.001);
}

fn hit_unit_cube(r: Ray) -> f32 {
  let inv_dir = 1.0 / r.direction;
  let t0 = (-1.0 - r.origin) * inv_dir;
  let t1 = (1.0 - r.origin) * inv_dir;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tnear = max(max(tmin.x, tmin.y), tmin.z);
  let tfar = min(min(tmax.x, tmax.y), tmax.z);
  if (tnear < tfar && tfar > 0.0) { return select(tfar, tnear, tnear > 0.001); }
  return -1.0;
}

fn hit_plane(normal: vec3f, d: f32, r: Ray) -> f32 {
  let denom = dot(normal, r.direction);
  if (abs(denom) > 1e-6) {
    let t = (d - dot(normal, r.origin)) / denom;
    if (t > 0.001) { return t; }
  }
  return -1.0;
}

fn hit_cylinder(r: Ray, r0: f32, r1: f32, t_out: ptr<function, f32>, n_out: ptr<function, vec3f>, uv_out: ptr<function, vec2f>) -> bool {
  let h = 1.0;
  let dr = r1 - r0;
  
  // Quadratic coefficients for a cone/cylinder side
  let k = dr / h;
  let origin_eff_radius = r0 + k * r.origin.y;
  
  let A = r.direction.x * r.direction.x + r.direction.z * r.direction.z - k * k * r.direction.y * r.direction.y;
  let B = 2.0 * (r.origin.x * r.direction.x + r.origin.z * r.direction.z - origin_eff_radius * k * r.direction.y);
  let C = r.origin.x * r.origin.x + r.origin.z * r.origin.z - origin_eff_radius * origin_eff_radius;

  var t_min = 1e10;
  var hit = false;

  // 1. Check side intersection
  let disc = B * B - 4.0 * A * C;
  if (disc > 0.0) {
    let sqrt_d = sqrt(disc);
    let t0 = (-B - sqrt_d) / (2.0 * A);
    let t1 = (-B + sqrt_d) / (2.0 * A);
    
    for (var i = 0; i < 2; i++) {
      let t = array<f32, 2>(t0, t1)[i];
      let y = r.origin.y + t * r.direction.y;
      if (t > 0.001 && t < t_min && y >= 0.0 && y <= h) {
        t_min = t;
        let p = r.origin + t * r.direction;
        // Normal is slanted based on the cone angle
        let slant = -k * (r0 + k * y);
        *n_out = normalize(vec3f(p.x, slant, p.z));
        *uv_out = vec2f(atan2(p.z, p.x) / (2.0 * 3.14159) + 0.5, y);
        hit = true;
      }
    }
  }

  // 2. Check Caps (Top at y=1, Bottom at y=0)
  let caps = array<f32, 2>(0.0, 1.0);
  let radii = array<f32, 2>(r0, r1);
  for (var i = 0; i < 2; i++) {
    let py = caps[i];
    let t = (py - r.origin.y) / r.direction.y;
    if (t > 0.001 && t < t_min) {
      let p = r.origin + t * r.direction;
      if (p.x * p.x + p.z * p.z <= radii[i] * radii[i]) {
        t_min = t;
        *n_out = vec3f(0.0, f32(i) * 2.0 - 1.0, 0.0);
        *uv_out = (p.xz / (max(r0, r1) * 2.0)) + 0.5;
        hit = true;
      }
    }
  }

  if (hit) { *t_out = t_min; }
  return hit;
}

fn hit_torus(r: Ray, Ra: f32, ra: f32) -> f32 {
  var po = 1.0;
  
  let Ra2 = Ra * Ra;
  let ra2 = ra * ra;
  
  let m = dot(r.origin, r.origin);
  let n = dot(r.origin, r.direction);

  // 1. Bounding sphere early exit
  let bounds_radius = Ra + ra;
  let h_bound = n * n - m + bounds_radius * bounds_radius;
  if (h_bound < 0.0) { return -1.0; }
  
  // 2. Compute Quartic Coefficients
  // We use r.origin.y and r.direction.y because your shader treats Y as UP
  let k = (m - ra2 - Ra2) / 2.0;
  let k3 = n;
  let k2 = n * n + Ra2 * r.direction.y * r.direction.y + k;
  let k1 = k * n + Ra2 * r.origin.y * r.direction.y;
  let k0 = k * k + Ra2 * r.origin.y * r.origin.y - Ra2 * ra2;
  
  // Numerical stability: handle cases where k1 is near zero by reciprocal transformation
  var K3 = k3; var K2 = k2; var K1 = k1; var K0 = k0;
  if (abs(k3 * (k3 * k3 - k2) + k1) < 0.01) {
    po = -1.0;
    let inv_k0 = 1.0 / k0;
    K1 = k3 * inv_k0;
    K2 = k2 * inv_k0;
    K3 = k1 * inv_k0;
    K0 = inv_k0;
  }

  let c2 = (2.0 * K2 - 3.0 * K3 * K3) / 3.0;
  let c1 = 2.0 * (K3 * (K3 * K3 - K2) + K1);
  let c0 = (K3 * (K3 * (-3.0 * K3 * K3 + 4.0 * K2) - 8.0 * K1) + 4.0 * K0) / 3.0;
  
  let Q = c2 * c2 + c0;
  let R = 3.0 * c0 * c2 - c2 * c2 * c2 - c1 * c1;
  
  let h = R * R - Q * Q * Q;
  var z = 0.0;
  
  if (h < 0.0) {
    // 4 real intersections
    let sQ = sqrt(Q);
    z = 2.0 * sQ * cos(acos(clamp(R / (sQ * Q), -1.0, 1.0)) / 3.0);
  } else {
    // 2 real intersections
    let sQ = pow(sqrt(h) + abs(R), 1.0/3.0);
    z = sign(R) * abs(sQ + Q / sQ);
  }     
  z = c2 - z;
  
  var d1 = z - 3.0 * c2;
  var d2 = z * z - 3.0 * c0;
  
  if (abs(d1) < 1.0e-4) {
    if (d2 < 0.0) { return -1.0; }
    d2 = sqrt(d2);
  } else {
    if (d1 < 0.0) { return -1.0; }
    d1 = sqrt(d1 / 2.0);
    d2 = c1 / d1;
  }

  // 3. Solve the two quadratics
  var result = 1e20;

  // First quadratic
  var h1 = d1 * d1 - z + d2;
  if (h1 > 0.0) {
    h1 = sqrt(h1);
    var t1 = -d1 - h1 - K3; if(po < 0.0){ t1 = 2.0/t1; }
    var t2 = -d1 + h1 - K3; if(po < 0.0){ t2 = 2.0/t2; }
    if (t1 > 0.001) { result = t1; }
    if (t2 > 0.001) { result = min(result, t2); }
  }

  // Second quadratic
  var h2 = d1 * d1 - z - d2;
  if (h2 > 0.0) {
    h2 = sqrt(h2);
    var t3 = d1 - h2 - K3; if(po < 0.0){ t3 = 2.0/t3; }
    var t4 = d1 + h2 - K3; if(po < 0.0){ t4 = 2.0/t4; }
    if (t3 > 0.001) { result = min(result, t3); }
    if (t4 > 0.001) { result = min(result, t4); }
  }

  return select(result, -1.0, result > 1e10);
}

fn trace_sphere(ray_world: Ray, s: TransformedObject, hit: ptr<function, SurfaceHit>) {
  var local_ray: Ray;
  local_ray.origin = (s.inv_matrix * vec4f(ray_world.origin, 1.0)).xyz;
  local_ray.direction = (s.inv_matrix * vec4f(ray_world.direction, 0.0)).xyz;
  
  let t = hit_unit_sphere(local_ray);
  if (t > 0.001 && t < (*hit).t) {
    (*hit).t = t; 
    (*hit).m_idx = s.material_idx;
    
    let local_normal = local_ray.origin + local_ray.direction * t;
    
    // UV Mapping
    let phi = atan2(local_normal.z, local_normal.x);
    let theta = asin(clamp(local_normal.y, -1.0, 1.0));
    (*hit).hit_uv = vec2f(0.5 + phi / (2.0 * 3.14159265), 0.5 + theta / 3.14159265);
    
    // Tangent Basis
    var local_t = vec3f(-local_normal.z, 0.0, local_normal.x);
    if (abs(local_normal.y) > 0.999) { local_t = vec3f(1.0, 0.0, 0.0); }
    local_t = normalize(local_t);
    let local_b = cross(local_normal, local_t);
    
    // Transform to World Space
    let n_mat = transpose(mat3x3f(s.inv_matrix[0].xyz, s.inv_matrix[1].xyz, s.inv_matrix[2].xyz));
    (*hit).hit_n = normalize(n_mat * local_normal);
    (*hit).tangent = normalize(n_mat * local_t);
    (*hit).bitangent = normalize(n_mat * local_b);
    (*hit).hit_p = ray_world.origin + ray_world.direction * t;
  }
}

fn trace_cube(ray_world: Ray, c: TransformedObject, hit: ptr<function, SurfaceHit>) {
  var local_ray: Ray;
  local_ray.origin = (c.inv_matrix * vec4f(ray_world.origin, 1.0)).xyz;
  local_ray.direction = (c.inv_matrix * vec4f(ray_world.direction, 0.0)).xyz;
  
  let t = hit_unit_cube(local_ray);
  if (t > 0.001 && t < (*hit).t) {
    (*hit).t = t; 
    (*hit).m_idx = c.material_idx;
    
    let local_hit = local_ray.origin + local_ray.direction * t;
    let d = abs(local_hit);
    let max_d = max(max(d.x, d.y), d.z);

    var local_n: vec3f; var local_t: vec3f; var local_b: vec3f;

    if (max_d == d.x) { 
      let s = sign(local_hit.x);
      local_n = vec3f(s, 0.0, 0.0);
      local_t = vec3f(0.0, 0.0, -s); 
      local_b = vec3f(0.0, 1.0, 0.0);
      (*hit).hit_uv = vec2f(-s * local_hit.z, local_hit.y) * 0.5 + 0.5;
    } else if (max_d == d.y) { 
      let s = sign(local_hit.y);
      local_n = vec3f(0.0, s, 0.0);
      local_t = vec3f(1.0, 0.0, 0.0); 
      local_b = vec3f(0.0, 0.0, s);
      (*hit).hit_uv = vec2f(local_hit.x, s * local_hit.z) * 0.5 + 0.5;
    } else { 
      let s = sign(local_hit.z);
      local_n = vec3f(0.0, 0.0, s);
      local_t = vec3f(s, 0.0, 0.0); 
      local_b = vec3f(0.0, 1.0, 0.0);
      (*hit).hit_uv = vec2f(s * local_hit.x, local_hit.y) * 0.5 + 0.5;
    }

    let n_mat = transpose(mat3x3f(c.inv_matrix[0].xyz, c.inv_matrix[1].xyz, c.inv_matrix[2].xyz));
    (*hit).hit_n = normalize(n_mat * local_n);
    (*hit).tangent = normalize(n_mat * local_t);
    (*hit).bitangent = normalize(n_mat * local_b);
    (*hit).hit_p = ray_world.origin + ray_world.direction * t;
  }
}

fn trace_plane(ray_world: Ray, p: Plane, hit: ptr<function, SurfaceHit>) {
  let t = hit_plane(p.normal, p.d, ray_world);
  if (t > 0.001 && t < (*hit).t) {
    (*hit).t = t; 
    (*hit).m_idx = p.material_idx;
    (*hit).hit_n = p.normal;
    (*hit).hit_p = ray_world.origin + ray_world.direction * t;
    
    var tangent = vec3f(1.0, 0.0, 0.0);
    if (abs((*hit).hit_n.x) > 0.9) { tangent = vec3f(0.0, 0.0, 1.0); }
    (*hit).tangent = normalize(cross((*hit).hit_n, tangent));
    (*hit).bitangent = normalize(cross((*hit).hit_n, (*hit).tangent));
    (*hit).hit_uv = vec2f(dot((*hit).hit_p, (*hit).tangent), dot((*hit).hit_p, (*hit).bitangent));
  }
}

fn trace_cylinder(ray_world: Ray, f: Cylinder, hit: ptr<function, SurfaceHit>) {
  var local_ray: Ray;
  local_ray.origin = (f.inv_matrix * vec4f(ray_world.origin, 1.0)).xyz;
  local_ray.direction = (f.inv_matrix * vec4f(ray_world.direction, 0.0)).xyz;

  var t: f32; var n: vec3f; var uv: vec2f;
  if (hit_cylinder(local_ray, 1.0, f.top_radius, &t, &n, &uv)) {
    if (t < (*hit).t) {
      (*hit).t = t;
      (*hit).m_idx = f.material_idx;
      (*hit).hit_uv = uv;
      
      let n_mat = transpose(mat3x3f(f.inv_matrix[0].xyz, f.inv_matrix[1].xyz, f.inv_matrix[2].xyz));
      (*hit).hit_n = normalize(n_mat * n);
      (*hit).hit_p = ray_world.origin + ray_world.direction * t;
    }
  }
}

fn trace_torus(ray: Ray, tor: Torus, hit: ptr<function, SurfaceHit>) {
  var l_ray: Ray;
  l_ray.origin = (tor.inv_matrix * vec4f(ray.origin, 1.0)).xyz;
  l_ray.direction = (tor.inv_matrix * vec4f(ray.direction, 0.0)).xyz;
  
  let ray_scale = length(l_ray.direction);
  l_ray.direction /= ray_scale; 

  // Major radius is 1.0 in local space, inner_radius is tor.inner_radius
  let t = hit_torus(l_ray, 1.0, tor.inner_radius * 1.);

  if (t > 0.) {
    let world_t = t / ray_scale;
    if (world_t < (*hit).t) {
      (*hit).t = world_t;
      (*hit).m_idx = tor.material_idx;
      
      let p = l_ray.origin + l_ray.direction * t;

      // 3. Normal logic: Point p minus the closest point on the center-ring
      let ring_p = normalize(vec3f(p.x, 0.0, p.z)); 
      let local_n = normalize(p - ring_p);
      
      let n_mat = mat3x3f(tor.inv_matrix[0].xyz, tor.inv_matrix[1].xyz, tor.inv_matrix[2].xyz);
      (*hit).hit_n = normalize(n_mat * local_n);

      // 4. UVs
      let u = (atan2(p.z, p.x) / 6.283185) + 0.5;
      let v = (atan2(p.y, length(p.xz) - 1.0) / 6.283185) + 0.5;
      (*hit).hit_uv = vec2f(u, v);
    }
  }
}

fn trace_tlas(ray: Ray, hit: ptr<function, SurfaceHit>) {
  let inv_dir = 1.0 / ray.direction;

  var stack: array<u32, 64>; 
  var stack_ptr: i32 = 0;
  
  stack[0] = 0;
  stack_ptr++;
  let base_t = intersect_aabb(ray.origin, inv_dir, tlas_nodes[0].aabb_min, tlas_nodes[0].aabb_max);
  if (base_t < 0. || base_t >= (*hit).t) {return;}

  while (stack_ptr > 0) {
    (*hit).count++;
    stack_ptr--;
    let node_idx = stack[stack_ptr];
    let node = tlas_nodes[node_idx];

    //let t_aabb = intersect_aabb(ray.origin, inv_dir, node.aabb_min, node.aabb_max);
    //if (t_aabb < 0. || t_aabb >= (*hit).t) { continue; }

    if (node.num_triangles > 0u) {
      // Leaf
      let start = node.next;
      let end = start + node.num_triangles;
      for (var i = start; i < end; i++) {
        let obj = objects[i];
        let otype = obj.object_type;
        if (HAS_MESHES && otype == 0) {
          let mesh = MeshInstance(obj.inv_matrix,obj.material_idx,0,bitcast<u32>(obj.pad0),bitcast<u32>(obj.pad1));
          trace_mesh(ray, mesh, hit);
        } else if (HAS_SPHERES && otype == 1) { 
          trace_sphere(ray, obj, hit);
        } else if (HAS_CUBES && otype == 2) { 
          trace_cube(ray, obj, hit);
        } else if (HAS_CYLINDERS && otype == 3) { 
          let cylinder = Cylinder(obj.inv_matrix,obj.material_idx,obj.pad0);
          trace_cylinder(ray, cylinder, hit);
        } else if (HAS_TORI && otype == 4) {
          let torus = Torus(obj.inv_matrix,obj.material_idx,obj.pad0);
          trace_torus(ray, torus, hit);
        }
      }
    } else {
      // Inner Node
      let left_idx = node_idx + 1u;
      let right_idx = node.next;
      let left_t = intersect_aabb(ray.origin, inv_dir, tlas_nodes[left_idx].aabb_min, tlas_nodes[left_idx].aabb_max);
      let right_t = intersect_aabb(ray.origin, inv_dir, tlas_nodes[right_idx].aabb_min, tlas_nodes[right_idx].aabb_max);
      if (left_t < right_t) {
        if (right_t >= 0. && right_t < (*hit).t) { stack[stack_ptr] = right_idx; stack_ptr++; }
        if (left_t >= 0. && left_t < (*hit).t) { stack[stack_ptr] = left_idx; stack_ptr++; }
      } else {
        if (left_t >= 0. && left_t < (*hit).t) { stack[stack_ptr] = left_idx; stack_ptr++; }
        if (right_t >= 0. && right_t < (*hit).t) { stack[stack_ptr] = right_idx; stack_ptr++; }
      }
    }
  }
}

fn trace_scene(ray: Ray) -> SurfaceHit {
  var hit = SurfaceHit(1e10, -1, vec3f(0.0), vec3f(0.0), vec2f(0.0), vec3f(0.0), vec3f(0.0), 0);
  
  if (HAS_PLANES) {
    for (var i = 0u; i < arrayLength(&planes); i++) {
      trace_plane(ray, planes[i], &hit);
    }
  }

  if (HAS_SPHERES || HAS_CUBES || HAS_CYLINDERS || HAS_TORI || HAS_MESHES) {
    trace_tlas(ray, &hit);
  }

  if (HAS_LIST_MESHES) {
    for (var i = 0u; i < arrayLength(&meshes); i++) {
      trace_mesh(ray, meshes[i], &hit);
    }
  }

  return hit;
}

struct PomResult {
  uv: vec2f,
  height: f32,
  hit: bool,
};

// --- PARALLAX OCCLUSION MAPPING FUNCTION ---
fn calculate_pom(initial_uv: vec2f, view_dir_ts: vec3f, start_depth: f32, mat: Material, height_idx: i32) -> PomResult {
  var res: PomResult;
  res.hit = false;
  let hm = mat.height_params.y;
  let is_height_map = hm < 0.0;
  let scale = abs(hm);
  let numLayers = mat.height_params.z;
  var layerDepth = 1.0 / numLayers;
  
  var currentLayerDepth = clamp(start_depth,0.,1.);
  let P = -(view_dir_ts.xy / view_dir_ts.z) * scale;
  let deltaTexCoords = P / numLayers;
  var currentTexCoords = initial_uv - P * mat.height_params.w;

  var s = sample_texture(height_idx, currentTexCoords).r;
  var currentDepthMapValue = select(s, 1.0 - s, is_height_map);

  for (var i: i32 = 0; i < 64; i++) {
    if (f32(i) >= numLayers || currentLayerDepth >= currentDepthMapValue) { break; }
    if (currentLayerDepth > 1 || currentLayerDepth < 0) { return res; }
    currentTexCoords += deltaTexCoords;
    s = sample_texture(height_idx, currentTexCoords).r;
    currentDepthMapValue = select(s, 1.0 - s, is_height_map);
    currentLayerDepth += layerDepth;
  }

  let prevTexCoords = currentTexCoords - deltaTexCoords;
  let prev_s = sample_texture(height_idx, prevTexCoords).r;
  let prevDepthMapValue = select(prev_s, 1.0 - prev_s, is_height_map);

  let afterDepth  = currentDepthMapValue - currentLayerDepth;
  let beforeDepth = prevDepthMapValue - currentLayerDepth + layerDepth;
  
  let weight = afterDepth / (afterDepth - beforeDepth);
  
  res.uv = mix(currentTexCoords, prevTexCoords, weight);
  // Final perceived height relative to the base plane
  res.height = mix(currentLayerDepth, currentLayerDepth - layerDepth, weight);
  res.hit = true;
  return res;
}


fn calculate_shadow_pom(current_uv: vec2f, current_height: f32, light_dir_ts: vec3f, mat: Material, height_idx: i32) -> PomResult {
  var res: PomResult;
  res.hit = false;
  res.uv = current_uv;
  res.height = current_height;

  // If the light is hitting the back of the polygon or is perfectly horizontal, 
  // it's either in shadow or calculation is undefined.
  if (light_dir_ts.z <= 0.0) { 
    res.hit = true;
    return res; 
  }

  let hm = mat.height_params.y;
  let is_height_map = hm < 0.0;
  let scale = abs(hm);
  let numLayers = mat.height_params.z;
  
  // How much depth we move per step
  let layerDepth = 1.0 / numLayers;
  
  // This is 'p' in your GLSL: the UV offset vector scaled by the height and light angle
  // We use (1.0 - current_height) because we are marching from the displaced point 
  // back up to the "ceiling" (0.0 depth).
  let p = (light_dir_ts.xy / light_dir_ts.z) * scale * (layerDepth);

  var shadow_uv = current_uv;
  var shadow_depth = current_height; // The current depth of the point we found in POM
  
  // We step UP toward the surface (depth 0.0)
  // Note: In POM, depth 0.0 is the top, 1.0 is the bottom.
  for (var i: i32 = 0; i < 32; i++) {
    if (f32(i)/2. >= numLayers || shadow_depth <= 0.0) { break; }
    
    // Move UV toward light and decrease depth (moving toward the surface plane)
    shadow_uv += p;
    shadow_depth -= layerDepth;
    
    let s = sample_texture(height_idx, shadow_uv).r;
    let map_depth = select(s, 1.0 - s, is_height_map);
    
    // If the map says the "wall" is higher (smaller depth) than our ray, we are occluded
    if (map_depth < shadow_depth) {
      res.hit = true;
      res.uv = shadow_uv;
      res.height = map_depth;
      return res;
    }
  }
  
  return res; 
}

fn refraction(I: vec3f, N: vec3f, ior: f32, ior2: f32) -> vec3f {
  var cosi: f32 = clamp(dot(I, N), -1.0, 1.0);
  var n: vec3f = N;
  var etai: f32 = ior2;
  var etat: f32 = ior;

  if (cosi < 0.0) {
    cosi = -cosi;
  } else {
    etai = ior;
    etat = ior2;
    n = -N;
  }

  let eta: f32 = etai / etat;
  let k: f32 = 1.0 - eta * eta * (1.0 - cosi * cosi);
  
  if (k < 0.0) {
    return vec3f(0.0);
  } else {
    return eta * I + (eta * cosi - sqrt(k)) * n;
  }
}

fn fresnel(I: vec3f, N: vec3f, ior: f32, ior2: f32) -> f32 {
  var cosi: f32 = clamp(dot(I, N), -1.0, 1.0);
  var etai: f32 = ior2;
  var etat: f32 = ior;

  if (cosi > 0.0) {
    etai = ior;
    etat = ior2;
  }

  // Compute sint using Snell's law
  let sint: f32 = (etai / etat) * sqrt(max(0.0, 1.0 - cosi * cosi));

  // Total internal reflection
  if (sint >= 1.0) {
    return 1.0;
  } else {
    let cost: f32 = sqrt(max(0.0, 1.0 - sint * sint));
    let abs_cosi: f32 = abs(cosi);
    
    let Rs: f32 = ((etat * abs_cosi) - (etai * cost)) / ((etat * abs_cosi) + (etai * cost));
    let Rp: f32 = ((etai * abs_cosi) - (etat * cost)) / ((etai * abs_cosi) + (etat * cost));
    
    return (Rs * Rs + Rp * Rp) / 2.0;
  }
}

struct SurfaceContext {
  albedo: vec3f,
  normal: vec3f,
  emittance: vec3f,
  roughness: f32,
};

fn get_surface_context(hit: SurfaceHit, mat: Material, tbn: mat3x3f, uv: vec2f) -> SurfaceContext {
  var ctx: SurfaceContext;
  
  // 1. Resolve Normal
  ctx.normal = hit.hit_n;
  let normal_idx = mat.normal_idx;
  if (normal_idx >= 0) {
    var n_map = sample_texture(normal_idx, uv).xyz * 2.0 - 1.0;
    n_map.y = -n_map.y; // Standard Y-flip for many normal map formats
    n_map = normalize(n_map * vec3f(mat.height_params.x, mat.height_params.x, 1.0));
    ctx.normal = normalize(tbn * n_map);
  }

  // 2. Resolve Albedo
  ctx.albedo = mat.albedo;
  let albedo_idx = mat.albedo_idx;
  if (albedo_idx >= 0) {
    let tex_color = sample_texture(albedo_idx, uv);
    ctx.albedo *= pow(tex_color.rgb, vec3f(2.2)); // sRGB to Linear
  }

  ctx.roughness = mat.roughness;
  let roughness_idx = mat.roughness_idx;
  if (roughness_idx >= 0) {
    ctx.roughness *= sample_texture(roughness_idx, uv).r;
  }

  // 3. Resolve Emittance
  ctx.emittance = mat.emittance;
  
  return ctx;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let idx = id.y * params.width + id.x;
  
  rng_state = idx + params.frame_count * 912373u;
  rand_pcg();

  let screen_uv = (vec2f(id.xy) + vec2f(rand_pcg(), rand_pcg())) / vec2f(f32(params.width), f32(params.height));
  let ray_dir = normalize(mix(mix(params.ray00.xyz, params.ray10.xyz, screen_uv.x), mix(params.ray01.xyz, params.ray11.xyz, screen_uv.x), 1.-screen_uv.y));
  var ray = Ray(params.eye.xyz, ray_dir);

  //var hit = trace_scene(ray);
  //textureStore(output_tex, id.xy, vec4f(vec3f(1.-log(log(hit.t)+1.)), 1.0));
  //textureStore(output_tex, id.xy, vec4f(hit.hit_n, 1.0));
  //hit.hit_uv = fract(hit.hit_uv); textureStore(output_tex, id.xy, vec4f(hit.hit_uv.x,hit.hit_uv.y,1. - hit.hit_uv.x * hit.hit_uv.y, 1.0));
  //return;
  
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);

  var beers_dist = 0.;

  for (var bounce = 0; bounce < BOUNCE_LIMIT; bounce++) {
    var hit = trace_scene(ray);
    //throughput*=pow(0.9,f32(hit.count));
    
    if (hit.m_idx == -1) {
      if (HAS_SKYBOX) { radiance += throughput * min(sample_sky(ray.direction),vec3f(2.)); }
      else { radiance += throughput * vec3f(0.02, 0.03, 2.05); }
      break;
    }

    let mat = materials[hit.m_idx];
    var final_uv = hit.hit_uv * mat.uv_scale;
    var final_n = hit.hit_n;
    let tbn = mat3x3f(hit.tangent, hit.bitangent, hit.hit_n);
    var currentheight = 0.;

    beers_dist += hit.t;

    // --- PARALLAX OCCLUSION MAPPING ---
    let height_idx = mat.height_idx;
    if (HAS_HEIGHTMAPS && height_idx >= 0) {
      let view_ts = normalize(transpose(tbn) * (-ray.direction)); // Ray towards eye in Tangent Space
      if (view_ts.z > 0.0) {
        let pom = calculate_pom(final_uv, view_ts, 0., mat, height_idx);
        final_uv = pom.uv;
        currentheight = pom.height;
      }
    }

    let ctx = get_surface_context(hit, mat, tbn, final_uv);

    radiance += throughput * ctx.emittance;
    if (length(ctx.emittance) > 1) { break; }

    /*
    // Use true geometric normal for origin offset to prevent shadow acne from displaced normals
    ray.origin = (ray.origin + ray.direction * hit.t) + hit.hit_n * 0.001;

    // Use the final mapped normal for bounce reflection calculation
    let diffuse = normalize(ctx.normal + random_unit_vector());
    let specular = reflect(ray.direction, ctx.normal);
    ray.direction = normalize(mix(specular, diffuse, ctx.roughness));
    throughput *= ctx.albedo;

    if (HAS_HEIGHTMAPS && height_idx >= 0) {
      let light_ts = normalize(transpose(tbn) * (ray.direction));
      let shadow_res = calculate_shadow_pom(final_uv, currentheight, light_ts, mat, height_idx);
      if (shadow_res.hit) {
        final_uv = shadow_res.uv;

        let ctx = get_surface_context(hit, mat, tbn, final_uv);

        radiance += throughput * ctx.emittance;
        if (length(ctx.emittance) > 0.1) { break; }

        let diffuse = normalize(ctx.normal + random_unit_vector());
        let specular = reflect(ray.direction, ctx.normal);
        ray.direction = normalize(mix(specular, diffuse, ctx.roughness));
        throughput *= ctx.albedo;
      }
    }
    */
    //*
    // --- POSITION UPDATE ---
    let hit_pos = ray.origin + ray.direction * hit.t;
    
    // --- MATERIAL LOGIC ---
    var kr: f32 = 0.0;
    let roughness = ctx.roughness;
    
    if (mat.material_type == 2) { // DIELECTRIC (Glass)
      let cosi = dot(ray.direction, ctx.normal);
      let entering = cosi < 0.0;
      var normal = ctx.normal;
      if (!entering) { normal *= -1; }
      
      // 1. If we hit the surface from the INSIDE, we are exiting.
      // Apply Beer's Law to the throughput based on the distance traveled (hit.t)
      if (entering) {
        beers_dist = 0;
      } else {
        let density = mat.concentration;
        // Absorption coefficient sigma = -log(albedo)
        // We use max(albedo, 0.0001) to avoid log(0) which is undefined
        let sigma = -log(max(ctx.albedo, vec3f(0.0001))) * density;
        // Beer's Law: attenuation = e^(-sigma * distance)
        let attenuation = exp(-sigma * beers_dist);
        let glow = ctx.emittance * (vec3f(1.0) - attenuation);
        
        // Add the glow to the accumulated radiance
        radiance += throughput * glow;
        throughput *= attenuation;
      }

      // 2. Standard Fresnel calculation
      // If entering: ior1=1.0, ior2=mat.ior. If exiting: ior1=mat.ior, ior2=1.0
      let kr = fresnel(ray.direction, ctx.normal, mat.ior, 1.0);
      
      if (rand_pcg() > kr) {
        // --- REFRACT ---
        let refracted_dir = refraction(ray.direction, ctx.normal, mat.ior, 1.0);
        
        // Apply roughness to the transmission
        ray.direction = normalize(mix(refracted_dir, -normal + random_unit_vector(), roughness));
        //ray.direction = refracted_dir;

        // Nudge: If entering, nudge INTO the mesh. If exiting, nudge OUT of the mesh.
        // Since ctx.normal always faces the ray, -ctx.normal always pushes "forward"
        ray.origin = hit_pos - normal * 0.01;
        
        // Note: We don't multiply by albedo here because Beer's Law handled it on exit!
        // If you want "surface tint" in addition to volumetric, you can multiply here too.
      } else {
        // --- REFLECT ---
        let specular = reflect(ray.direction, normal);
        ray.direction = normalize(mix(specular, normal + random_unit_vector(), roughness));
        
        // Nudge OUTSIDE
        ray.origin = hit_pos + normal * 0.001;
        
        // Reflection on glass is usually uncolored (white), so no albedo multiplication
      }
    }
    else if (mat.material_type == 1) { // METAL
      // Pure specular reflection, colored by albedo
      let specular = reflect(ray.direction, ctx.normal);
      ray.direction = normalize(mix(specular, ctx.normal + random_unit_vector(), roughness));
      
      ray.origin = hit_pos + ctx.normal * 0.001;
      throughput *= ctx.albedo;
    } 
    else { // OPAQUE / PLASTIC
      let diffuse = normalize(ctx.normal + random_unit_vector());
      let specular = reflect(ray.direction, ctx.normal);
      
      // Simple Schlick approximation for plastic highlights
      let F0 = mat.ior; // 0.04 for 1.5 
      let F = F0 + (1.0 - F0) * pow(1.0 - max(0.0, dot(-ray.direction, ctx.normal)), 5.0);
      
      if (rand_pcg() < F) {
        ray.direction = normalize(mix(specular, ctx.normal + random_unit_vector(), roughness));
        throughput *= mix(vec3f(1.),ctx.albedo,roughness);
      } else {
        ray.direction = diffuse;
        throughput *= ctx.albedo;
      }
      
      ray.origin = hit_pos + ctx.normal * 0.001;
    }

    // --- HEIGHTMAP / POM LOGIC ---
    if (HAS_HEIGHTMAPS && mat.height_idx >= 0) {
      let light_ts = normalize(transpose(tbn) * (ray.direction));
      let shadow_res = calculate_shadow_pom(final_uv, currentheight, light_ts, mat, mat.height_idx);
      if (shadow_res.hit) {
      // Update UV and hit context for the displaced surface
      final_uv = shadow_res.uv;
      let ctx_pom = get_surface_context(hit, mat, tbn, final_uv);
      
      radiance += throughput * ctx_pom.emittance;
      if (length(ctx_pom.emittance) > 0.1) { break; }
      
      // Re-apply diffuse/specular bounce based on displaced normal
      let diffuse = normalize(ctx_pom.normal + random_unit_vector());
      let specular = reflect(ray.direction, ctx_pom.normal);
      ray.direction = normalize(mix(specular, diffuse, roughness));
      throughput *= ctx_pom.albedo;
      }
    }
    //*/

    // Russian Roulette
    if (bounce < 2) { continue; } 
    let p = max(throughput.r, max(throughput.g, throughput.b));
    let survival_prob = clamp(p, 0.05, 0.95);
    if (rand_pcg() > survival_prob) {
      break; 
    }
    throughput /= survival_prob;
  }

  let weight = 1.0 / f32(params.frame_count + 1u);
  let old_c = accum_buffer[idx].rgb;
  var final_c = mix(old_c, radiance, weight);
  accum_buffer[idx] = vec4f(final_c, 1.0);

  final_c *= vec3f(params.exposure);
  //final_c = final_c / (final_c + vec3(1.0));
  final_c = pow(final_c, vec3f(0.4545));
  
  textureStore(output_tex, id.xy, vec4f(final_c, 1.0));
}
