// E-field update shader — Ampère's law: ∂E/∂t = (1/ε₀) ∇×H
//
// Each thread updates one grid cell's Ex, Ey, Ez values.
// Note the index offsets are reversed vs. H update because E and H are
// at staggered positions (Yee grid):
//   Ex(i,j,k) += ceh * ( Hz(i,j,k) - Hz(i,j-1,k) - Hy(i,j,k) + Hy(i,j,k-1) )
//   Ey(i,j,k) += ceh * ( Hx(i,j,k) - Hx(i,j,k-1) - Hz(i,j,k) + Hz(i-1,j,k) )
//   Ez(i,j,k) += ceh * ( Hy(i,j,k) - Hy(i-1,j,k) - Hx(i,j,k) + Hx(i,j-1,k) )

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  cee: f32,  // E self-coefficient (1.0 for lossless)
  ceh: f32,  // E curl coefficient: dt / (ε₀ * dx)
}

@group(0) @binding(0) var<uniform> params: Params;

// H-field components (read-only during E update)
@group(0) @binding(1) var<storage, read> Hx: array<f32>;
@group(0) @binding(2) var<storage, read> Hy: array<f32>;
@group(0) @binding(3) var<storage, read> Hz: array<f32>;

// E-field components (read-write)
@group(0) @binding(4) var<storage, read_write> Ex: array<f32>;
@group(0) @binding(5) var<storage, read_write> Ey: array<f32>;
@group(0) @binding(6) var<storage, read_write> Ez: array<f32>;

fn idx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * params.nx + k * params.nx * params.ny;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;

  // E update needs i-1, j-1, k-1 neighbors, so start from 1
  // Also skip if out of range
  if (i < 1u || j < 1u || k < 1u || i >= params.nx || j >= params.ny || k >= params.nz) {
    return;
  }

  let ijk = idx(i, j, k);
  let cee = params.cee;
  let ceh = params.ceh;

  // Ex: curl_x(H) = dHz/dy - dHy/dz
  Ex[ijk] = cee * Ex[ijk] + ceh * (
    (Hz[ijk] - Hz[idx(i, j - 1u, k)]) -
    (Hy[ijk] - Hy[idx(i, j, k - 1u)])
  );

  // Ey: curl_y(H) = dHx/dz - dHz/dx
  Ey[ijk] = cee * Ey[ijk] + ceh * (
    (Hx[ijk] - Hx[idx(i, j, k - 1u)]) -
    (Hz[ijk] - Hz[idx(i - 1u, j, k)])
  );

  // Ez: curl_z(H) = dHy/dx - dHx/dy
  Ez[ijk] = cee * Ez[ijk] + ceh * (
    (Hy[ijk] - Hy[idx(i - 1u, j, k)]) -
    (Hx[ijk] - Hx[idx(i, j - 1u, k)])
  );
}
