// Boundary condition shader — zeros E fields on all 6 grid faces (PEC boundary).
//
// Each thread checks if it's on a boundary face and zeros the E components there.
// This is the simplest boundary: Perfect Electric Conductor walls.
// Waves reflect off these boundaries.

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> Ex: array<f32>;
@group(0) @binding(2) var<storage, read_write> Ey: array<f32>;
@group(0) @binding(3) var<storage, read_write> Ez: array<f32>;

fn idx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * params.nx + k * params.nx * params.ny;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;

  if (i >= params.nx || j >= params.ny || k >= params.nz) {
    return;
  }

  // Check if this cell is on any boundary face
  let onBoundary = (i == 0u) || (i == params.nx - 1u) ||
                   (j == 0u) || (j == params.ny - 1u) ||
                   (k == 0u) || (k == params.nz - 1u);

  if (onBoundary) {
    let ijk = idx(i, j, k);
    Ex[ijk] = 0.0;
    Ey[ijk] = 0.0;
    Ez[ijk] = 0.0;
  }
}
