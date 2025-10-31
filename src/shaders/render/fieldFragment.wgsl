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
  let brightness = config.x;
  let electricEnergyFactor = config.y;
  let magneticEnergyFactor = config.z;
  
  // Material is stored as normalized [0,1] in rgba8unorm texture
  // permeability is in x (red), permittivity is in y (green), conductivity is in z (blue)
  let permeability = material.x;
  let permittivity = material.y;
  let conductivity = material.z;
  
  // Calculate energy densities separately (matching reference renderEnergy shader)
  // Store in separate channels: R = electric energy, G = magnetic energy
  let brightnessSquared = brightness * brightness;
  let electricEnergy = electricEnergyFactor * permittivity * dot(electricField, electricField);
  let magneticEnergy = magneticEnergyFactor * permeability * dot(magneticField, magneticField);
  
  let scaledElectricEnergy = brightnessSquared * electricEnergy;
  let scaledMagneticEnergy = brightnessSquared * magneticEnergy;
  
  // Simple bloom effect - extract bright areas (matching reference bloomExtract)
  let bloomThreshold = 0.1;
  let avgEnergy = 0.5 * (scaledElectricEnergy + scaledMagneticEnergy);
  let bloomAmount = step(bloomThreshold, avgEnergy);
  let bloomElectric = scaledElectricEnergy * bloomAmount * 0.3;
  let bloomMagnetic = scaledMagneticEnergy * bloomAmount * 0.3;
  
  // Combine base energy with bloom (matching reference draw shader logic)
  let finalElectric = min(1.0, scaledElectricEnergy + bloomElectric + bloomMagnetic * 0.5);
  let finalMagnetic = min(1.0, scaledMagneticEnergy + bloomMagnetic + bloomElectric * 0.5);
  
  // Color mapping (matching reference: red=electric, blue=magnetic, green=bloom)
  // This creates the gradient effect with proper color separation
  let color = vec3<f32>(
    finalElectric,           // Red channel: electric energy
    bloomElectric + bloomMagnetic,  // Green channel: bloom (yellow when both present)
    finalMagnetic            // Blue channel: magnetic energy
  );
  
  return vec4<f32>(color, 1.0);
}
