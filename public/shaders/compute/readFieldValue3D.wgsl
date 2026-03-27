// Transitional 3D readback contract for volumetric sampling.
// While field storage is still 2D in compatibility mode, z is accepted and ignored.
@group(0) @binding(0) var electricFieldTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<f32>; // x, y, z, textureSize

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) _global_id: vec3<u32>) {
  let x = params.x;
  let y = params.y;
  let texSize = i32(params.w);

  let pixelX = i32(x * f32(texSize));
  let pixelY = i32(y * f32(texSize));

  let clampedX = clamp(pixelX, 0, texSize - 1);
  let clampedY = clamp(pixelY, 0, texSize - 1);

  let fieldValue = textureLoad(electricFieldTexture, vec2<i32>(clampedX, clampedY), 0);

  outputBuffer[0] = fieldValue.x;
  outputBuffer[1] = fieldValue.y;
  outputBuffer[2] = fieldValue.z;
  outputBuffer[3] = length(fieldValue.xyz);
}
