// 3D readback contract for volumetric sampling.
@group(0) @binding(0) var electricFieldTexture: texture_3d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<f32>; // x, y, z, _pad

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) _global_id: vec3<u32>) {
  let x = params.x;
  let y = params.y;
  let z = params.z;

  let dims = textureDimensions(electricFieldTexture);
  let sizeX = i32(dims.x);
  let sizeY = i32(dims.y);
  let sizeZ = i32(dims.z);

  let pixelX = i32(x * f32(sizeX));
  let pixelY = i32(y * f32(sizeY));
  let pixelZ = i32(z * f32(sizeZ));

  let clampedX = clamp(pixelX, 0, sizeX - 1);
  let clampedY = clamp(pixelY, 0, sizeY - 1);
  let clampedZ = clamp(pixelZ, 0, sizeZ - 1);

  let fieldValue = textureLoad(electricFieldTexture, vec3<i32>(clampedX, clampedY, clampedZ), 0);

  outputBuffer[0] = fieldValue.x;
  outputBuffer[1] = fieldValue.y;
  outputBuffer[2] = fieldValue.z;
  outputBuffer[3] = length(fieldValue.xyz);
}
