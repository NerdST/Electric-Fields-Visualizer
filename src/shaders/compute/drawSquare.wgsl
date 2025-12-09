@group(0) @binding(0) var inputTex: texture_2d<f32>;

struct DrawParams {
  pos: vec2<f32>,
  size: vec2<f32>,
  value: vec4<f32>,
  keep: vec4<f32>,
};
@group(0) @binding(1) var<uniform> params: DrawParams;

@group(0) @binding(2) var outTex: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(coord) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
  let d = abs(params.pos - uv);
  let oldValue = textureLoad(inputTex, coord, 0);
  let within = all(d <= params.size);

  let result = select(oldValue, params.value + params.keep * oldValue, within);
  textureStore(outTex, coord, result);
}
