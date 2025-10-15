// import * as THREE from 'three';

// FDTD simulation of electric fields from point charges using WebGPU
///////////////////////////////////////////
const updateAlphaBeta = `
  @group(0) @binding(0) var materialTex: texture_2d<f32>;
  @group(0) @binding(1) var materialSampler: sampler;

  struct SimParams {
    dt: f32,
    cellSize: f32,
    _pad0: f32,
    _pad1: f32,
  };
  @group(0) @binding(2) var<uniform> sim: SimParams;

  @group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    let mat = textureSample(materialTex, materialSampler, uv).rgb;
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

    textureStore(outTex, vec2<i32>(gid.xy), vec4<f32>(alphaEl, betaEl, alphaMag, betaMag));
  }
`;

const updateElectric = `
  @group(0) @binding(0) var electricFieldTex: texture_2d<f32>;
  @group(0) @binding(1) var magneticFieldTex: texture_2d<f32>;
  @group(0) @binding(2) var alphaBetaFieldTex: texture_2d<f32>;
  @group(0) @binding(3) var fieldSampler: sampler;

  struct FieldParams {
    relativeCellSize: vec2<f32>,
    reflectiveBoundary: u32,
    _pad: u32,
  };
  @group(0) @binding(4) var<uniform> params: FieldParams;

  @group(0) @binding(5) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);

    if (params.reflectiveBoundary == 0u) {
      let b = 2.0 * params.relativeCellSize;
      
      let xAtMinBound = select(0.0, params.relativeCellSize.x, uv.x < b.x);
      let xAtMaxBound = select(0.0, -params.relativeCellSize.x, uv.x + b.x >= 1.0);
      let yAtMinBound = select(0.0, params.relativeCellSize.y, uv.y < b.y);
      let yAtMaxBound = select(0.0, -params.relativeCellSize.y, uv.y + b.y >= 1.0);

      if (xAtMinBound != 0.0 || xAtMaxBound != 0.0 || yAtMinBound != 0.0 || yAtMaxBound != 0.0) {
        let boundaryUV = uv + vec2<f32>(xAtMinBound + xAtMaxBound, yAtMinBound + yAtMaxBound);
        let boundaryField = textureSample(electricFieldTex, fieldSampler, boundaryUV);
        textureStore(outTex, vec2<i32>(gid.xy), boundaryField);
        return;
      }
    }

    let alphaBeta = textureSample(alphaBetaFieldTex, fieldSampler, uv).rg;
    
    let el = textureSample(electricFieldTex, fieldSampler, uv).rgb;
    let mag = textureSample(magneticFieldTex, fieldSampler, uv).rgb;
    let magXN = textureSample(magneticFieldTex, fieldSampler, uv - vec2<f32>(params.relativeCellSize.x, 0.0)).rgb;
    let magYN = textureSample(magneticFieldTex, fieldSampler, uv - vec2<f32>(0.0, params.relativeCellSize.y)).rgb;

    let newEl = vec3<f32>(
      alphaBeta.x * el.x + alphaBeta.y * (mag.z - magYN.z),
      alphaBeta.x * el.y + alphaBeta.y * (magXN.z - mag.z),
      alphaBeta.x * el.z + alphaBeta.y * ((mag.y - magXN.y) - (mag.x - magYN.x))
    );

    textureStore(outTex, vec2<i32>(gid.xy), vec4<f32>(newEl, 0.0));
  }
`;

const updateMagnetic = `
  @group(0) @binding(0) var electricFieldTex: texture_2d<f32>;
  @group(0) @binding(1) var magneticFieldTex: texture_2d<f32>;
  @group(0) @binding(2) var alphaBetaFieldTex: texture_2d<f32>;
  @group(0) @binding(3) var fieldSampler: sampler;

  struct FieldParams {
    relativeCellSize: vec2<f32>,
    reflectiveBoundary: u32,
    _pad: u32,
  };
  @group(0) @binding(4) var<uniform> params: FieldParams;

  @group(0) @binding(5) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);

    if (params.reflectiveBoundary == 0u) {
      let b = 2.0 * params.relativeCellSize;
      
      let xAtMinBound = select(0.0, params.relativeCellSize.x, uv.x < b.x);
      let xAtMaxBound = select(0.0, -params.relativeCellSize.x, uv.x + b.x >= 1.0);
      let yAtMinBound = select(0.0, params.relativeCellSize.y, uv.y < b.y);
      let yAtMaxBound = select(0.0, -params.relativeCellSize.y, uv.y + b.y >= 1.0);

      if (xAtMinBound != 0.0 || xAtMaxBound != 0.0 || yAtMinBound != 0.0 || yAtMaxBound != 0.0) {
        let boundaryUV = uv + vec2<f32>(xAtMinBound + xAtMaxBound, yAtMinBound + yAtMaxBound);
        let boundaryField = textureSample(magneticFieldTex, fieldSampler, boundaryUV);
        textureStore(outTex, vec2<i32>(gid.xy), boundaryField);
        return;
      }
    }

    let alphaBeta = textureSample(alphaBetaFieldTex, fieldSampler, uv).ba;

    let mag = textureSample(magneticFieldTex, fieldSampler, uv).rgb;
    let el = textureSample(electricFieldTex, fieldSampler, uv).rgb;
    let elXP = textureSample(electricFieldTex, fieldSampler, uv + vec2<f32>(params.relativeCellSize.x, 0.0)).rgb;
    let elYP = textureSample(electricFieldTex, fieldSampler, uv + vec2<f32>(0.0, params.relativeCellSize.y)).rgb;

    let newMag = vec3<f32>(
      alphaBeta.x * mag.x - alphaBeta.y * (elYP.z - el.z),
      alphaBeta.x * mag.y - alphaBeta.y * (el.z - elXP.z),
      alphaBeta.x * mag.z - alphaBeta.y * ((elXP.y - el.y) - (elYP.x - el.x))
    );

    textureStore(outTex, vec2<i32>(gid.xy), vec4<f32>(newMag, 0.0));
  }
`;

///////////////////////////////////////////
// const pointChargeShader = `
// @group(0) @binding(0) var<storage, read> charges: array<vec4<f32>>; // xyz: position, w: magnitude
// @group(0) @binding(1) var<uniform> gridConfig: vec4<f32>; // x: gridSizeX, y: gridSizeY, z: gridSizeZ, w: spacing
// @group(0) @binding(2) var<storage, read_write> fieldOutput: array<vec4<f32>>; // xyz: field vector, w: potential

// @compute @workgroup_size(64)
// fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
//     let index = global_id.x;
//     if (index >= arrayLength(&fieldOutput)) {
//         return;
//     }

//     // Calculate actual grid position
//     let gridSize = u32(gridConfig.x);
//     let spacing = gridConfig.w;
//     let x = f32(index % gridSize);
//     let y = f32(index / gridSize);
//     let position = vec3<f32>((x - f32(gridSize) * 0.5) * spacing, (y - f32(gridSize) * 0.5) * spacing, 0.0);

//     var totalField = vec3<f32>(0.0, 0.0, 0.0);
//     var totalPotential = 0.0;

//     for (var i = 0u; i < arrayLength(&charges); i = i + 1u) {
//         let chargePos = charges[i].xyz;
//         let chargeMag = charges[i].w;
//         let r = position - chargePos;
//         let distance = length(r);
//         let effectiveDistance = max(distance, 0.1); // Softening factor to avoid singularities
//         let fieldMagnitude = (8.9875517923e9 * chargeMag) / (effectiveDistance * effectiveDistance);
//         totalField = totalField + normalize(r) * fieldMagnitude;
//         totalPotential = totalPotential + (8.9875517923e9 * chargeMag) / effectiveDistance;
//     }

//     fieldOutput[index] = vec4<f32>(totalField, totalPotential);
// }`;

const injectSource = `
  @group(0) @binding(0) var sourceFieldTex: texture_2d<f32>;
  @group(0) @binding(1) var fieldTex: texture_2d<f32>;
  @group(0) @binding(2) var fieldSampler: sampler;

  struct SourceParams {
    dt: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
  };
  @group(0) @binding(3) var<uniform> params: SourceParams;

  @group(0) @binding(4) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    
    let source = textureSample(sourceFieldTex, fieldSampler, uv);
    let field = textureSample(fieldTex, fieldSampler, uv);

    textureStore(outTex, vec2<i32>(gid.xy), field + params.dt * source);
  }
`;

const decaySource = `
  @group(0) @binding(0) var sourceFieldTex: texture_2d<f32>;
  @group(0) @binding(1) var fieldSampler: sampler;

  struct DecayParams {
    dt: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
  };
  @group(0) @binding(2) var<uniform> params: DecayParams;

  @group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    
    let source = textureSample(sourceFieldTex, fieldSampler, uv);
    let decayedSource = source * pow(0.1, params.dt);

    textureStore(outTex, vec2<i32>(gid.xy), decayedSource);
  }
`;

const drawSquare = `
  @group(0) @binding(0) var inputTex: texture_2d<f32>;
  @group(0) @binding(1) var fieldSampler: sampler;

  struct DrawParams {
    pos: vec2<f32>,
    size: vec2<f32>,
    value: vec4<f32>,
    keep: vec4<f32>,
  };
  @group(0) @binding(2) var<uniform> params: DrawParams;

  @group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    let d = abs(params.pos - uv);
    let oldValue = textureSample(inputTex, fieldSampler, uv);
    let within = all(d <= params.size);

    let result = select(oldValue, params.value + params.keep * oldValue, within);
    textureStore(outTex, vec2<i32>(gid.xy), result);
  }
`;

const drawEllipse = `
  @group(0) @binding(0) var inputTex: texture_2d<f32>;
  @group(0) @binding(1) var fieldSampler: sampler;

  struct DrawParams {
    pos: vec2<f32>,
    radius: vec2<f32>,
    value: vec4<f32>,
    keep: vec4<f32>,
  };
  @group(0) @binding(2) var<uniform> params: DrawParams;

  @group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    let d = (params.pos - uv) / params.radius;
    let distanceSquared = dot(d, d);
    let within = distanceSquared <= 1.0;
    
    let oldValue = textureSample(inputTex, fieldSampler, uv);
    let result = select(oldValue, params.value + params.keep * oldValue, within);
    
    textureStore(outTex, vec2<i32>(gid.xy), result);
  }
`;

// Add the missing point charge shader
const pointChargeShader = `
@group(0) @binding(0) var<storage, read> charges: array<vec4<f32>>; // xyz: position, w: magnitude
@group(0) @binding(1) var<uniform> gridConfig: vec4<f32>; // x: gridSizeX, y: gridSizeY, z: gridSizeZ, w: spacing
@group(0) @binding(2) var<storage, read_write> fieldOutput: array<vec4<f32>>; // xyz: field vector, w: potential

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if (index >= arrayLength(&fieldOutput)) {
        return;
    }

    // Calculate actual grid position
    let gridSize = u32(gridConfig.x);
    let spacing = gridConfig.w;
    let x = f32(index % gridSize);
    let y = f32(index / gridSize);
    let position = vec3<f32>((x - f32(gridSize) * 0.5) * spacing, (y - f32(gridSize) * 0.5) * spacing, 0.0);

    var totalField = vec3<f32>(0.0, 0.0, 0.0);
    var totalPotential = 0.0;

    for (var i = 0u; i < arrayLength(&charges); i = i + 1u) {
        let chargePos = charges[i].xyz;
        let chargeMag = charges[i].w;
        let r = position - chargePos;
        let distance = length(r);
        let effectiveDistance = max(distance, 0.1); // Softening factor to avoid singularities
        let fieldMagnitude = (8.9875517923e9 * chargeMag) / (effectiveDistance * effectiveDistance);
        totalField = totalField + normalize(r) * fieldMagnitude;
        totalPotential = totalPotential + (8.9875517923e9 * chargeMag) / effectiveDistance;
    }

    fieldOutput[index] = vec4<f32>(totalField, totalPotential);
}`;

// Add field visualization shaders
const fieldVertShader = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = (pos[vertexIndex] + 1.0) * 0.5;
  return output;
}`;

const fieldFragShader = `
@group(0) @binding(0) var fieldTexture: texture_2d<f32>;
@group(0) @binding(1) var fieldSampler: sampler;

struct RenderConfig {
  gridSize: f32,
  maxPotential: f32,
  minPotential: f32,
  time: f32,
};
@group(0) @binding(2) var<uniform> config: RenderConfig;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let field = textureSample(fieldTexture, fieldSampler, uv);
  let electricField = field.xyz;
  let potential = field.w;
  
  // Normalize potential for color mapping
  let normalizedPotential = (potential - config.minPotential) / (config.maxPotential - config.minPotential);
  
  // Color based on electric field magnitude and potential
  let fieldMagnitude = length(electricField.xy);
  let normalizedField = clamp(fieldMagnitude / 1000.0, 0.0, 1.0);
  
  // Create a color based on potential (blue to red)
  let r = clamp(normalizedPotential, 0.0, 1.0);
  let b = clamp(1.0 - normalizedPotential, 0.0, 1.0);
  let g = normalizedField * 0.5;
  
  return vec4<f32>(r, g, b, 1.0);
}`;

// Enhanced FDTD Simulation class
class FDTDSimulation {
  private device: GPUDevice;
  private pipelines: Map<string, GPUComputePipeline> = new Map();
  private textures: Map<string, GPUTexture> = new Map();
  private buffers: Map<string, GPUBuffer> = new Map();
  private sampler!: GPUSampler;
  private textureSize: number;
  private dt: number = 0.001;
  private cellSize: number = 0.01;
  private time: number = 0;

  constructor(device: GPUDevice, textureSize: number = 512) {
    this.device = device;
    this.textureSize = textureSize;
    this.initializeSampler();
  }

  private initializeSampler() {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  async initializePipelines() {
    const shaders = {
      updateAlphaBeta,
      updateElectric,
      updateMagnetic,
      injectSource,
      decaySource,
      drawSquare,
      drawEllipse,
    };

    for (const [name, shader] of Object.entries(shaders)) {
      const module = this.device.createShaderModule({ code: shader });
      const pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          module,
          entryPoint: 'main',
        },
      });
      this.pipelines.set(name, pipeline);
    }
  }

  initializeTextures() {
    // Create main field textures (double buffered)
    this.createTexture('electricField', this.textureSize, this.textureSize);
    this.createTexture('electricFieldNext', this.textureSize, this.textureSize);
    this.createTexture('magneticField', this.textureSize, this.textureSize);
    this.createTexture('magneticFieldNext', this.textureSize, this.textureSize);

    // Create auxiliary textures
    this.createTexture('alphaBetaField', this.textureSize, this.textureSize);
    this.createTexture('materialField', this.textureSize, this.textureSize);
    this.createTexture('sourceField', this.textureSize, this.textureSize);

    // Initialize material properties (vacuum by default)
    this.initializeMaterialField();
    this.initializeAlphaBeta();
  }

  private initializeMaterialField() {
    // Initialize with vacuum properties
    const materialData = new Float32Array(this.textureSize * this.textureSize * 4);
    for (let i = 0; i < materialData.length; i += 4) {
      materialData[i] = 4.0 * Math.PI * 1e-7; // permeability (μ₀)
      materialData[i + 1] = 8.854187817e-12; // permittivity (ε₀)  
      materialData[i + 2] = 0.0; // conductivity (σ)
      materialData[i + 3] = 0.0; // unused
    }

    this.device.queue.writeTexture(
      { texture: this.textures.get('materialField')! },
      materialData,
      { bytesPerRow: this.textureSize * 16 },
      { width: this.textureSize, height: this.textureSize }
    );
  }

  private initializeAlphaBeta() {
    const simParams = new Float32Array([this.dt, this.cellSize, 0, 0]);
    const simBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(simBuffer, 0, simParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('updateAlphaBeta')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('materialField')!.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: simBuffer } },
        { binding: 3, resource: this.textures.get('alphaBetaField')!.createView() },
      ],
    });

    this.runComputePass('updateAlphaBeta', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));
  }

  createTexture(name: string, width: number, height: number, format: GPUTextureFormat = 'rgba32float') {
    const texture = this.device.createTexture({
      size: [width, height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.textures.set(name, texture);
    return texture;
  }

  createBuffer(name: string, size: number, usage: GPUBufferUsageFlags) {
    const buffer = this.device.createBuffer({ size, usage });
    this.buffers.set(name, buffer);
    return buffer;
  }

  // Add a point charge source - Fixed to avoid circular reference
  addPointCharge(x: number, y: number, charge: number) {
    const nx = (x + 1) * 0.5; // Convert from [-1,1] to [0,1]
    const ny = (y + 1) * 0.5;

    const drawParams = new Float32Array([
      nx, ny, // position in [0,1] space
      0.02, 0.02, // radius
      0, 0, charge * 1e3, 0, // value (electric field source) - reduced scaling
      0, 0, 0, 0, // keep (don't keep old values for sources)
    ]);

    const paramsBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, drawParams);

    // Create temporary texture for drawing
    const tempTexture = this.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('drawEllipse')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceField')!.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('drawEllipse', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to source field
    this.copyTexture(tempTexture, this.textures.get('sourceField')!);
    tempTexture.destroy();
  }

  private copyTexture(source: GPUTexture, destination: GPUTexture) {
    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      { texture: source },
      { texture: destination },
      [this.textureSize, this.textureSize]
    );
    this.device.queue.submit([commandEncoder.finish()]);
  }

  // Main simulation step
  step() {
    this.time += this.dt;

    // Update electric field
    this.updateElectricField();

    // Update magnetic field  
    this.updateMagneticField();

    // Inject sources
    this.injectSources();

    // Decay sources
    this.decaySources();

    // Swap buffers
    this.swapBuffers();
  }

  private updateElectricField() {
    const fieldParams = new Float32Array([
      1.0 / this.textureSize, 1.0 / this.textureSize, // relativeCellSize
      0, 0, // reflectiveBoundary = false, padding
    ]);

    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, fieldParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('updateElectric')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('electricField')!.createView() },
        { binding: 1, resource: this.textures.get('magneticField')!.createView() },
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: paramsBuffer } },
        { binding: 5, resource: this.textures.get('electricFieldNext')!.createView() },
      ],
    });

    this.runComputePass('updateElectric', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));
  }

  private updateMagneticField() {
    const fieldParams = new Float32Array([
      1.0 / this.textureSize, 1.0 / this.textureSize, // relativeCellSize
      0, 0, // reflectiveBoundary = false, padding
    ]);

    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, fieldParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('updateMagnetic')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('electricField')!.createView() },
        { binding: 1, resource: this.textures.get('magneticField')!.createView() },
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: paramsBuffer } },
        { binding: 5, resource: this.textures.get('magneticFieldNext')!.createView() },
      ],
    });

    this.runComputePass('updateMagnetic', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));
  }

  private injectSources() {
    const sourceParams = new Float32Array([this.dt, 0, 0, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, sourceParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('injectSource')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceField')!.createView() },
        { binding: 1, resource: this.textures.get('electricFieldNext')!.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: paramsBuffer } },
        { binding: 4, resource: this.textures.get('electricFieldNext')!.createView() },
      ],
    });

    this.runComputePass('injectSource', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));
  }

  private decaySources() {
    const decayParams = new Float32Array([this.dt, 0, 0, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, decayParams);

    // Create temporary texture for decay operation
    const tempTexture = this.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('decaySource')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceField')!.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('decaySource', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back
    this.copyTexture(tempTexture, this.textures.get('sourceField')!);
    tempTexture.destroy();
  }

  private swapBuffers() {
    // Swap electric field buffers
    const tempE = this.textures.get('electricField');
    this.textures.set('electricField', this.textures.get('electricFieldNext')!);
    this.textures.set('electricFieldNext', tempE!);

    // Swap magnetic field buffers
    const tempM = this.textures.get('magneticField');
    this.textures.set('magneticField', this.textures.get('magneticFieldNext')!);
    this.textures.set('magneticFieldNext', tempM!);
  }

  runComputePass(pipelineName: string, bindGroup: GPUBindGroup, workgroupsX: number, workgroupsY: number = 1, workgroupsZ: number = 1) {
    const pipeline = this.pipelines.get(pipelineName);
    if (!pipeline) throw new Error(`Pipeline ${pipelineName} not found`);

    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();

    computePass.setPipeline(pipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    computePass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  getSampler() {
    return this.sampler;
  }

  getTexture(name: string) {
    return this.textures.get(name);
  }

  getBuffer(name: string) {
    return this.buffers.get(name);
  }

  getPipeline(name: string) {
    return this.pipelines.get(name);
  }

  getTime() {
    return this.time;
  }

  // Add cleanup method
  destroy() {
    for (const texture of this.textures.values()) {
      texture.destroy();
    }
    for (const buffer of this.buffers.values()) {
      buffer.destroy();
    }
  }
}

// Setup render pipeline for FDTD - Fixed device access issue
const setupFDTDRenderPipeline = async (fdtdSim: FDTDSimulation, gpuDevice: GPUDevice) => {
  // Get or create the canvas element
  let canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fdtd-canvas';
    canvas.width = 512;
    canvas.height = 512;
    canvas.style.display = 'block';
    canvas.style.border = '1px solid #ccc';
    document.body.appendChild(canvas);
  }

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU context not available');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: gpuDevice,
    format,
  });

  const vertexModule = gpuDevice.createShaderModule({
    code: fieldVertShader
  });

  const fragmentModule = gpuDevice.createShaderModule({
    code: fieldFragShader
  });

  renderPipeline = gpuDevice.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: vertexModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: fragmentModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  renderConfigBuffer = gpuDevice.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  return context;
};

// Updated initialization - Fixed device scope and error handling
const initialize = async () => {
  try {
    console.log('Initializing WebGPU with FDTD...');
    const { device: gpuDevice, fdtdSim } = await initializeWebGPUWithFDTD();
    device = gpuDevice; // Set global device reference
    fdtdSimulation = fdtdSim;

    console.log('WebGPU and FDTD initialized successfully');

    // Setup render pipeline for FDTD - pass device explicitly
    renderContext = await setupFDTDRenderPipeline(fdtdSimulation, device);

    console.log('FDTD simulation ready. Starting render loop...');
    animate();

  } catch (error) {
    console.error('Error initializing:', error);
    // Create error display
    const errorDiv = document.createElement('div');
    errorDiv.innerHTML = `<h3>WebGPU Error:</h3><p>${error}</p>`;
    errorDiv.style.color = 'red';
    errorDiv.style.padding = '20px';
    document.body.appendChild(errorDiv);
  }
};

// Add error handling to animation loop
const animate = (currentTime: number = performance.now()) => {
  try {
    requestAnimationFrame(animate);

    if (fdtdSimulation && renderContext && device) {
      // Run FDTD simulation step
      fdtdSimulation.step();

      // Render the results
      updateFDTDRender(renderContext, fdtdSimulation);
    }
  } catch (error) {
    console.error('Animation error:', error);
  }
};

const ChargeCanvas = () => {
  return <div style={{ margin: 0, padding: 0, overflow: 'hidden' }} />;
};

export default ChargeCanvas;