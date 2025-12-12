// Compute shader to read field value at a specific point
@group(0) @binding(0) var electricFieldTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<f32>; // x, y, textureSize, padding

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // Read parameters
  let x = params.x;
  let y = params.y;
  let texSize = i32(params.z);
  
  // Convert normalized coordinates [0,1] to pixel coordinates
  let pixelX = i32(x * f32(texSize));
  let pixelY = i32(y * f32(texSize));
  
  // Clamp to texture bounds
  let clampedX = clamp(pixelX, 0, texSize - 1);
  let clampedY = clamp(pixelY, 0, texSize - 1);
  
  // Read the electric field value at this point
  let fieldValue = textureLoad(electricFieldTexture, vec2<i32>(clampedX, clampedY), 0);
  
  // Store in output buffer (x, y, z components of E field + magnitude)
  outputBuffer[0] = fieldValue.x;
  outputBuffer[1] = fieldValue.y;
  outputBuffer[2] = fieldValue.z;
  outputBuffer[3] = length(fieldValue.xyz); // magnitude
}
