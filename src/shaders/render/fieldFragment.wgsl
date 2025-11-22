@group(0) @binding(0) var electricFieldTexture: texture_2d<f32>;
@group(0) @binding(1) var magneticFieldTexture: texture_2d<f32>;
@group(0) @binding(2) var materialTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> config: vec4<f32>; // brightness, electricEnergyFactor, magneticEnergyFactor, time

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let dims = textureDimensions(electricFieldTexture);
  let coord = vec2<i32>(uv * vec2<f32>(dims));
  
  // Sample field values
  let electricField = textureLoad(electricFieldTexture, coord, 0).xyz;
  let magneticField = textureLoad(magneticFieldTexture, coord, 0).xyz;
  let material = textureLoad(materialTexture, coord, 0).xyz;
  
  // Extract config values
  let brightness = config.x * 10.0; // Moderate multiplier for good visibility
  let electricEnergyFactor = config.y;
  let magneticEnergyFactor = config.z;
  
  // Material properties (normalized [0,1] from rgba8unorm)
  let permeability = material.x;
  let permittivity = material.y;
  
  // Calculate field magnitudes (Ez is primary component in 2D TM mode)
  let Ez = electricField.z;
  let Hz_magnitude = length(magneticField.xy);
  
  // Energy densities: U_E = 0.5 * ε * E², U_H = 0.5 * μ * H²
  let electricEnergy = electricEnergyFactor * permittivity * Ez * Ez;
  let magneticEnergy = magneticEnergyFactor * permeability * Hz_magnitude * Hz_magnitude;
  
  // Apply brightness scaling with better dynamic range
  let scaledElectricEnergy = brightness * electricEnergy;
  let scaledMagneticEnergy = brightness * magneticEnergy;
  
  // Apply gamma correction for better visibility of low values
  let gamma = 0.5;
  let electricVis = pow(clamp(scaledElectricEnergy, 0.0, 1.0), gamma);
  let magneticVis = pow(clamp(scaledMagneticEnergy, 0.0, 1.0), gamma);
  
  // Enhanced bloom effect for bright regions
  let bloomThreshold = 0.05;
  let bloomStrength = 0.5;
  let totalEnergy = electricVis + magneticVis;
  let bloom = max(0.0, totalEnergy - bloomThreshold) * bloomStrength;
  
  // Color mapping with better contrast:
  // Red = Electric field energy (Ez)
  // Blue = Magnetic field energy (Hx, Hy)
  // White/Yellow = High energy regions (bloom)
  let finalElectric = clamp(electricVis + bloom * 0.5, 0.0, 1.0);
  let finalMagnetic = clamp(magneticVis + bloom * 0.5, 0.0, 1.0);
  let finalBloom = clamp(bloom, 0.0, 1.0);
  
  let color = vec3<f32>(
    finalElectric,                    // Red: electric field
    finalBloom,                       // Green: bloom/mixed energy
    finalMagnetic                     // Blue: magnetic field
  );
  
  return vec4<f32>(color, 1.0);
}
