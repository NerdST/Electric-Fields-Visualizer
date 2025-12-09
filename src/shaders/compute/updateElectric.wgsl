@group(0) @binding(0) var electricFieldTex: texture_2d<f32>;
@group(0) @binding(1) var magneticFieldTex: texture_2d<f32>;
@group(0) @binding(2) var alphaBetaFieldTex: texture_2d<f32>;

struct FieldParams {
  relativeCellSize: vec2<f32>,
  reflectiveBoundary: u32,
  _pad: u32,
};
@group(0) @binding(3) var<uniform> params: FieldParams;

@group(0) @binding(4) var outTex: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  let coord = vec2<i32>(gid.xy);
  
  // Early exit
  if (coord.x >= i32(dims.x) || coord.y >= i32(dims.y)) {
    return;
  }

  // Cache offset calculations
  let offset_x = i32(params.relativeCellSize.x * f32(dims.x));
  let offset_y = i32(params.relativeCellSize.y * f32(dims.y));
  
  // Simple boundary: wrap or clamp
  let coord_xn = vec2<i32>(coord.x - offset_x, coord.y);
  let coord_yn = vec2<i32>(coord.x, coord.y - offset_y);
  
  let alphaBeta = textureLoad(alphaBetaFieldTex, coord, 0).rg;
  let el = textureLoad(electricFieldTex, coord, 0).rgb;
  let mag = textureLoad(magneticFieldTex, coord, 0).rgb;
  let magXN = textureLoad(magneticFieldTex, coord_xn, 0).rgb;
  let magYN = textureLoad(magneticFieldTex, coord_yn, 0).rgb;

  let newEl = vec3<f32>(
    alphaBeta.x * el.x + alphaBeta.y * (mag.z - magYN.z),
    alphaBeta.x * el.y + alphaBeta.y * (magXN.z - mag.z),
    alphaBeta.x * el.z + alphaBeta.y * ((mag.y - magXN.y) - (mag.x - magYN.x))
  );

  textureStore(outTex, coord, vec4<f32>(newEl, 0.0));
}
