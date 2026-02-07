@group(0) @binding(0) var sourceFieldTex: texture_2d<f32>;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;

struct SourceParams {
  dt: f32,
  time: f32,
  oscillatorCount: f32,
  _pad2: f32,
};
@group(0) @binding(2) var<uniform> params: SourceParams;

@group(0) @binding(3) var outTex: texture_storage_2d<rgba16float, write>;

struct Oscillator {
  pos: vec2<f32>,
  radius: f32,
  amplitude: f32,
  frequency: f32,
  phase: f32,
  _pad: vec2<f32>,
};

struct OscillatorBuffer {
  data: array<Oscillator>,
};

@group(0) @binding(4) var<storage, read> oscillators: OscillatorBuffer;

const TWO_PI: f32 = 6.283185307179586;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(coord) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
  
  let source = textureLoad(sourceFieldTex, coord, 0);
  let field = textureLoad(fieldTex, coord, 0);

  let count = u32(params.oscillatorCount);
  var oscillationZ: f32 = 0.0;
  var i: u32 = 0u;
  loop {
    if (i >= count) {
      break;
    }

    let osc = oscillators.data[i];
    let radius = max(osc.radius, 0.000001);
    let d = (osc.pos - uv) / vec2<f32>(radius, radius);
    let distanceSquared = dot(d, d);
    if (distanceSquared <= 1.0) {
      let phase = TWO_PI * osc.frequency * params.time + osc.phase;
      oscillationZ = oscillationZ + osc.amplitude * sin(phase);
    }
    i = i + 1u;
  }

  let oscillatingSource = vec4<f32>(0.0, 0.0, oscillationZ, 0.0);

  textureStore(outTex, coord, field + params.dt * (source + oscillatingSource));
}
