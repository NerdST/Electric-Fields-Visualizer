@group(0) @binding(0) var sourceFieldTex: texture_2d<f32>;

struct DecayParams {
  decayFactor: f32,  // Pre-computed as exp(-ln(10) * dt) on CPU side
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};
@group(0) @binding(1) var<uniform> params: DecayParams;

@group(0) @binding(2) var outTex: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  
  let source = textureLoad(sourceFieldTex, coord, 0);
  let decayedSource = source * params.decayFactor;

  textureStore(outTex, coord, decayedSource);
}
