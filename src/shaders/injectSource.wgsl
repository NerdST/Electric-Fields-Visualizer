// Source injection shader — adds an oscillating signal to a single grid cell.
//
// This is a "soft source": it adds to the existing field value rather than
// overwriting it, so waves can pass through the source point.
// Only one thread actually does work (the one matching the source position).

struct SourceParams {
  ix: u32,
  iy: u32,
  iz: u32,
  polarization: u32, // 0 = x, 1 = y, 2 = z
  value: f32,        // amplitude * sin(2π * freq * t), precomputed on CPU
  nx: u32,
  ny: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: SourceParams;
@group(0) @binding(1) var<storage, read_write> Ex: array<f32>;
@group(0) @binding(2) var<storage, read_write> Ey: array<f32>;
@group(0) @binding(3) var<storage, read_write> Ez: array<f32>;

@compute @workgroup_size(1)
fn main() {
  let idx = params.ix + params.iy * params.nx + params.iz * params.nx * params.ny;

  switch params.polarization {
    case 0u: { Ex[idx] = Ex[idx] + params.value; }
    case 1u: { Ey[idx] = Ey[idx] + params.value; }
    case 2u: { Ez[idx] = Ez[idx] + params.value; }
    default: {}
  }
}
