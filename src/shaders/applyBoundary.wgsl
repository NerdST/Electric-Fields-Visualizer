// Absorbing sponge boundary — damps fields near grid edges.
// Uses cubic damping profile: stronger near the edge.
// Waves fade to nothing instead of reflecting.

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  spongeDepth: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> Ex: array<f32>;
@group(0) @binding(2) var<storage, read_write> Ey: array<f32>;
@group(0) @binding(3) var<storage, read_write> Ez: array<f32>;
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

  if (i >= params.nx || j >= params.ny || k >= params.nz) {
    return;
  }

  let depth = params.spongeDepth;
  let nxm = params.nx - 1u;
  let nym = params.ny - 1u;
  let nzm = params.nz - 1u;

  // How deep into sponge layer?
  var di: i32 = 0;
  if (i < depth) { di = i32(depth - i); }
  if (i > nxm - depth) { di = max(di, i32(i - (nxm - depth))); }

  var dj: i32 = 0;
  if (j < depth) { dj = i32(depth - j); }
  if (j > nym - depth) { dj = max(dj, i32(j - (nym - depth))); }

  var dk: i32 = 0;
  if (k < depth) { dk = i32(depth - k); }
  if (k > nzm - depth) { dk = max(dk, i32(k - (nzm - depth))); }

  let d = max(di, max(dj, dk));

  if (d <= 0) {
    return;
  }

  // Cubic damping: at boundary (t=1), decay ≈ 0.05
  let t = f32(d) / f32(depth);
  let decay = 1.0 - t * t * t * 0.95;

  let ijk = idx(i, j, k);
  Ex[ijk] *= decay;
  Ey[ijk] *= decay;
  Ez[ijk] *= decay;
  Hx[ijk] *= decay;
  Hy[ijk] *= decay;
  Hz[ijk] *= decay;
}
