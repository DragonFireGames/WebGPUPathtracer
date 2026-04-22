
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dest: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> ratio: vec2f;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dstSize = textureDimensions(dest);
  if (id.x >= dstSize.x || id.y >= dstSize.y) { return; }

  let srcSize = vec2f(textureDimensions(src));
  
  // Calculate continuous coordinates in the source texture
  let uv = vec2f(id.xy) / vec2f(dstSize);
  let samplePos = uv * ratio * srcSize - 0.5;
  
  // Get the integer coordinates of the 4 neighbors
  let f = fract(samplePos);
  let base = vec2i(floor(samplePos));

  // Fetch 4 neighboring pixels (clamped to prevent edge bleeding)
  let t00 = textureLoad(src, clamp(base + vec2i(0, 0), vec2i(0), vec2i(srcSize) - 1), 0);
  let t10 = textureLoad(src, clamp(base + vec2i(1, 0), vec2i(0), vec2i(srcSize) - 1), 0);
  let t01 = textureLoad(src, clamp(base + vec2i(0, 1), vec2i(0), vec2i(srcSize) - 1), 0);
  let t11 = textureLoad(src, clamp(base + vec2i(1, 1), vec2i(0), vec2i(srcSize) - 1), 0);

  // Bilinear interpolation math
  let color = mix(
    mix(t00, t10, f.x),
    mix(t01, t11, f.x),
    f.y
  );
  
  textureStore(dest, id.xy, vec4f(color.rgb, 1.0));
}