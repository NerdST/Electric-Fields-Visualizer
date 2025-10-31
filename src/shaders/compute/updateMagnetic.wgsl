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

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);

  if (params.reflectiveBoundary == 0u) {
    let b = vec2<i32>(2.0 * params.relativeCellSize * vec2<f32>(dims));
    
    let xAtMinBound = select(0, i32(params.relativeCellSize.x * f32(dims.x)), coord.x < b.x);
    let xAtMaxBound = select(0, -i32(params.relativeCellSize.x * f32(dims.x)), coord.x + b.x >= i32(dims.x));
    let yAtMinBound = select(0, i32(params.relativeCellSize.y * f32(dims.y)), coord.y < b.y);
    let yAtMaxBound = select(0, -i32(params.relativeCellSize.y * f32(dims.y)), coord.y + b.y >= i32(dims.y));

    if (xAtMinBound != 0 || xAtMaxBound != 0 || yAtMinBound != 0 || yAtMaxBound != 0) {
      let boundaryCoord = coord + vec2<i32>(xAtMinBound + xAtMaxBound, yAtMinBound + yAtMaxBound);
      let boundaryField = textureLoad(magneticFieldTex, boundaryCoord, 0);
      textureStore(outTex, coord, boundaryField);
      return;
    }
  }

  let alphaBeta = textureLoad(alphaBetaFieldTex, coord, 0).ba;

  let mag = textureLoad(magneticFieldTex, coord, 0).rgb;
  let el = textureLoad(electricFieldTex, coord, 0).rgb;
  let elXP = textureLoad(electricFieldTex, coord + vec2<i32>(i32(params.relativeCellSize.x * f32(dims.x)), 0), 0).rgb;
  let elYP = textureLoad(electricFieldTex, coord + vec2<i32>(0, i32(params.relativeCellSize.y * f32(dims.y))), 0).rgb;

  let newMag = vec3<f32>(
    alphaBeta.x * mag.x - alphaBeta.y * (elYP.z - el.z),
    alphaBeta.x * mag.y - alphaBeta.y * (el.z - elXP.z),
    alphaBeta.x * mag.z - alphaBeta.y * ((elXP.y - el.y) - (elYP.x - el.x))
  );

  textureStore(outTex, coord, vec4<f32>(newMag, 0.0));
}
