@group(0) @binding(0) var electricFieldTex: texture_2d<f32>;
@group(0) @binding(1) var magneticFieldTex: texture_2d<f32>;
@group(0) @binding(2) var alphaBetaFieldTex: texture_2d<f32>;

struct FieldParams {
  relativeCellSize: vec2<f32>,
  reflectiveBoundary: u32,
  _pad: u32,
};
@group(0) @binding(3) var<uniform> params: FieldParams;

@group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;

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
  
  let coord_xp = vec2<i32>(coord.x + offset_x, coord.y);
  let coord_yp = vec2<i32>(coord.x, coord.y + offset_y);
  
  let alphaBeta = textureLoad(alphaBetaFieldTex, coord, 0).ba;

  let mag = textureLoad(magneticFieldTex, coord, 0).rgb;
  let el = textureLoad(electricFieldTex, coord, 0).rgb;
  let elXP = textureLoad(electricFieldTex, coord_xp, 0).rgb;
  let elYP = textureLoad(electricFieldTex, coord_yp, 0).rgb;

  let newMag = vec3<f32>(
    alphaBeta.x * mag.x - alphaBeta.y * (elYP.z - el.z),
    alphaBeta.x * mag.y - alphaBeta.y * (el.z - elXP.z),
    alphaBeta.x * mag.z - alphaBeta.y * ((elXP.y - el.y) - (elYP.x - el.x))
  );

  // Prevent numerical overflow/underflow - clamp to reasonable physical bounds
  // Most EM fields don't exceed ±1e6 A/m in practical simulations
  let maxField = 1e6;
  let clampedMag = clamp(newMag, vec3<f32>(-maxField), vec3<f32>(maxField));

  textureStore(outTex, coord, vec4<f32>(clampedMag, 0.0));
}
