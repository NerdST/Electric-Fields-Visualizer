// Continuous source injection: Ez += dt * sourceEz
// This is how charges radiate — a persistent source field
// continuously pumps energy into E each timestep.

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  dt: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> sourceEz: array<f32>;
@group(0) @binding(2) var<storage, read_write> Ez: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;

  if (i >= params.nx || j >= params.ny || k >= params.nz) {
    return;
  }

  let idx = i + j * params.nx + k * params.nx * params.ny;
  let src = sourceEz[idx];

  if (src != 0.0) {
    Ez[idx] = Ez[idx] + params.dt * src;
  }
}
