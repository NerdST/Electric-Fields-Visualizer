@group(0) @binding(0) var materialTex: texture_2d<f32>;

struct SimParams {
  dt: f32,
  cellSize: f32,
  _pad0: f32,
  _pad1: f32,
};
@group(0) @binding(1) var<uniform> sim: SimParams;

@group(0) @binding(2) var outTex: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  let mat = textureLoad(materialTex, coord, 0).rgb;
  
  // Material texture stores normalized [0,1] values in rgba8unorm format
  // permeability is in x (red), permittivity is in y (green), conductivity is in z (blue)
  // For vacuum: permeability ≈ 1.0, permittivity ≈ 1.0, conductivity = 0
  // The texture values are stored as normalized, so we use them directly
  let permeability = mat.x;
  let permittivity = mat.y;
  let conductivity = mat.z;

  let cEl = conductivity * sim.dt / (2.0 * permeability);
  let dEl = 1.0 / (1.0 + cEl);
  let alphaEl = (1.0 - cEl) * dEl;
  let betaEl = sim.dt / (permeability * sim.cellSize) * dEl;

  let cMag = conductivity * sim.dt / (2.0 * permittivity);
  let dMag = 1.0 / (1.0 + cMag);
  let alphaMag = (1.0 - cMag) * dMag;
  let betaMag = sim.dt / (permittivity * sim.cellSize) * dMag;

  textureStore(outTex, coord, vec4<f32>(alphaEl, betaEl, alphaMag, betaMag));
}
