// H-field update shader — Faraday's law: ∂H/∂t = -(1/μ₀) ∇×E
//
// Each thread updates one grid cell's Hx, Hy, Hz values.
// The curl of E at an H-location uses E values from neighboring cells:
//   Hx(i,j,k) -= che * ( Ez(i,j+1,k) - Ez(i,j,k) - Ey(i,j,k+1) + Ey(i,j,k) )
//   Hy(i,j,k) -= che * ( Ex(i,j,k+1) - Ex(i,j,k) - Ez(i+1,j,k) + Ez(i,j,k) )
//   Hz(i,j,k) -= che * ( Ey(i+1,j,k) - Ey(i,j,k) - Ex(i,j+1,k) + Ex(i,j,k) )

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  chh: f32,  // H self-coefficient (1.0 for lossless)
  che: f32,  // H curl coefficient: dt / (μ₀ * dx)
}

@group(0) @binding(0) var<uniform> params: Params;

// E-field components (read-only during H update)
@group(0) @binding(1) var<storage, read> Ex: array<f32>;
@group(0) @binding(2) var<storage, read> Ey: array<f32>;
@group(0) @binding(3) var<storage, read> Ez: array<f32>;

// H-field components (read-write)
@group(0) @binding(4) var<storage, read_write> Hx: array<f32>;
@group(0) @binding(5) var<storage, read_write> Hy: array<f32>;
@group(0) @binding(6) var<storage, read_write> Hz: array<f32>;

fn idx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * params.nx + k * params.nx * params.ny;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;

  // Skip boundary cells and out-of-range threads
  // H update needs i+1, j+1, k+1 neighbors, so stop one short of the edge
  if (i >= params.nx - 1u || j >= params.ny - 1u || k >= params.nz - 1u) {
    return;
  }

  let ijk = idx(i, j, k);
  let chh = params.chh;
  let che = params.che;

  // Hx: curl_x(E) = dEz/dy - dEy/dz
  Hx[ijk] = chh * Hx[ijk] - che * (
    (Ez[idx(i, j + 1u, k)] - Ez[ijk]) -
    (Ey[idx(i, j, k + 1u)] - Ey[ijk])
  );

  // Hy: curl_y(E) = dEx/dz - dEz/dx
  Hy[ijk] = chh * Hy[ijk] - che * (
    (Ex[idx(i, j, k + 1u)] - Ex[ijk]) -
    (Ez[idx(i + 1u, j, k)] - Ez[ijk])
  );

  // Hz: curl_z(E) = dEy/dx - dEx/dy
  Hz[ijk] = chh * Hz[ijk] - che * (
    (Ey[idx(i + 1u, j, k)] - Ey[ijk]) -
    (Ex[idx(i, j + 1u, k)] - Ex[ijk])
  );
}
