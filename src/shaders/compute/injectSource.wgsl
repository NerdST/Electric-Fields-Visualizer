@group(0) @binding(0) var sourceFieldTex: texture_2d<f32>;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;

struct SourceParams {
  dt: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};
@group(0) @binding(2) var<uniform> params: SourceParams;

@group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  
  let source = textureLoad(sourceFieldTex, coord, 0);
  let field = textureLoad(fieldTex, coord, 0);

  textureStore(outTex, coord, field + params.dt * source);
}
