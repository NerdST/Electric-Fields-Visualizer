@group(0) @binding(0) var electricFieldTexture: texture_2d<f32>;
@group(0) @binding(1) var magneticFieldTexture: texture_2d<f32>;
@group(0) @binding(2) var materialTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> config: vec4<f32>; // brightness, electricEnergyFactor, magneticEnergyFactor, time

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let dims = textureDimensions(electricFieldTexture);
  let maxCoord = vec2<f32>(dims) - vec2<f32>(1.0, 1.0);
  let coord = vec2<i32>(clamp(uv * vec2<f32>(dims), vec2<f32>(0.0, 0.0), maxCoord));
  
  // Sample field values
  let electricField = textureLoad(electricFieldTexture, coord, 0).xyz;
  let magneticField = textureLoad(magneticFieldTexture, coord, 0).xyz;
  let material = textureLoad(materialTexture, coord, 0).xyz;
  
  // Extract config values
  let brightness = max(config.x, 1e-6);
  let electricEnergyFactor = config.y;
  let magneticEnergyFactor = config.z;
  
  // Material properties (normalized [0,1] from rgba8unorm)
  let permeability = material.x;
  let permittivity = material.y;
  
  // Ez is primary electric component in 2D TM mode.
  let Ez = electricField.z;
  let Hz_magnitude = length(magneticField.xy);
  let eGain = 12.0 * brightness * electricEnergyFactor * max(permittivity, 1e-6);
  let hGain = 10.0 * brightness * magneticEnergyFactor * max(permeability, 1e-6);

  let eMag = abs(Ez);
  let eVis = 1.0 - exp(-eMag * eGain);
  let hVis = 1.0 - exp(-Hz_magnitude * hGain);

  let positiveColor = vec3<f32>(1.0, 0.28, 0.05);
  let negativeColor = vec3<f32>(0.10, 0.45, 1.0);
  let magneticColor = vec3<f32>(0.10, 0.95, 0.85);

  let electricColor = select(negativeColor, positiveColor, Ez >= 0.0);
  var color = electricColor * eVis + magneticColor * (0.45 * hVis);
  color = max(color, vec3<f32>(0.02, 0.02, 0.02));
  color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
  
  return vec4<f32>(color, 1.0);
}
