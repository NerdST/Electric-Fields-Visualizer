import React from 'react';

// FDTD simulation of electric fields from point charges using WebGPU
///////////////////////////////////////////

// Global variables
let device: GPUDevice;
let fdtdSimulation: FDTDSimulation;
let renderContext: GPUCanvasContext;
let renderPipeline: GPURenderPipeline;
let renderConfigBuffer: GPUBuffer;
let renderBindGroupLayout: GPUBindGroupLayout;
const updateAlphaBeta = `
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
    
    // Scale normalized values back to physical constants
    let permeability = 4.0 * 3.14159 * 1e-7; // μ₀ (vacuum permeability)
    let permittivity = 8.854187817e-12; // ε₀ (vacuum permittivity)
    let conductivity = 0.0; // σ (no conductivity for vacuum)

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
`;

const updateElectric = `
  @group(0) @binding(0) var electricFieldTex: texture_2d<f32>;
  @group(0) @binding(1) var magneticFieldTex: texture_2d<f32>;
  @group(0) @binding(2) var alphaBetaFieldTex: texture_2d<f32>;

  struct FieldParams {
    relativeCellSize: vec2<f32>,
    reflectiveBoundary: u32,
    _pad: u32,
  };
  @group(0) @binding(3) var<uniform> params: FieldParams;

  @group(0) @binding(4) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let coord = vec2<i32>(gid.xy);

    if (params.reflectiveBoundary == 0u) {
      let b = vec2<i32>(2.0 * params.relativeCellSize * vec2<f32>(dims));
      
      let xAtMinBound = select(0, i32(params.relativeCellSize.x * f32(dims.x)), coord.x < b.x);
      let xAtMaxBound = select(0, -i32(params.relativeCellSize.x * f32(dims.x)), coord.x + b.x >= i32(dims.x));
      let yAtMinBound = select(0, i32(params.relativeCellSize.y * f32(dims.y)), coord.y < b.y);
      let yAtMaxBound = select(0, -i32(params.relativeCellSize.y * f32(dims.y)), coord.y + b.y >= i32(dims.y));

      if (xAtMinBound != 0 || xAtMaxBound != 0 || yAtMinBound != 0 || yAtMaxBound != 0) {
        let boundaryCoord = coord + vec2<i32>(xAtMinBound + xAtMaxBound, yAtMinBound + yAtMaxBound);
        let boundaryField = textureLoad(electricFieldTex, boundaryCoord, 0);
        textureStore(outTex, coord, boundaryField);
        return;
      }
    }

    let alphaBeta = textureLoad(alphaBetaFieldTex, coord, 0).rg;
    
    let el = textureLoad(electricFieldTex, coord, 0).rgb;
    let mag = textureLoad(magneticFieldTex, coord, 0).rgb;
    let magXN = textureLoad(magneticFieldTex, coord - vec2<i32>(i32(params.relativeCellSize.x * f32(dims.x)), 0), 0).rgb;
    let magYN = textureLoad(magneticFieldTex, coord - vec2<i32>(0, i32(params.relativeCellSize.y * f32(dims.y))), 0).rgb;

    let newEl = vec3<f32>(
      alphaBeta.x * el.x + alphaBeta.y * (mag.z - magYN.z),
      alphaBeta.x * el.y + alphaBeta.y * (magXN.z - mag.z),
      alphaBeta.x * el.z + alphaBeta.y * ((mag.y - magXN.y) - (mag.x - magYN.x))
    );

    textureStore(outTex, coord, vec4<f32>(newEl, 0.0));
  }
`;

const updateMagnetic = `
  @group(0) @binding(0) var electricFieldTex: texture_2d<f32>;
  @group(0) @binding(1) var magneticFieldTex: texture_2d<f32>;
  @group(0) @binding(2) var alphaBetaFieldTex: texture_2d<f32>;

  struct FieldParams {
    relativeCellSize: vec2<f32>,
    reflectiveBoundary: u32,
    _pad: u32,
  };
  @group(0) @binding(3) var<uniform> params: FieldParams;

  @group(0) @binding(4) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let coord = vec2<i32>(gid.xy);

    if (params.reflectiveBoundary == 0u) {
      let b = vec2<i32>(2.0 * params.relativeCellSize * vec2<f32>(dims));
      
      let xAtMinBound = select(0, i32(params.relativeCellSize.x * f32(dims.x)), coord.x < b.x);
      let xAtMaxBound = select(0, -i32(params.relativeCellSize.x * f32(dims.x)), coord.x + b.x >= i32(dims.x));
      let yAtMinBound = select(0, i32(params.relativeCellSize.y * f32(dims.y)), coord.y < b.y);
      let yAtMaxBound = select(0, -i32(params.relativeCellSize.y * f32(dims.y)), coord.y + b.y >= i32(dims.y));

      if (xAtMinBound != 0 || xAtMaxBound != 0 || yAtMinBound != 0 || yAtMaxBound != 0) {
        let boundaryCoord = coord + vec2<i32>(xAtMinBound + xAtMaxBound, yAtMinBound + yAtMaxBound);
        let boundaryField = textureLoad(magneticFieldTex, boundaryCoord, 0);
        textureStore(outTex, coord, boundaryField);
        return;
      }
    }

    let alphaBeta = textureLoad(alphaBetaFieldTex, coord, 0).ba;

    let mag = textureLoad(magneticFieldTex, coord, 0).rgb;
    let el = textureLoad(electricFieldTex, coord, 0).rgb;
    let elXP = textureLoad(electricFieldTex, coord + vec2<i32>(i32(params.relativeCellSize.x * f32(dims.x)), 0), 0).rgb;
    let elYP = textureLoad(electricFieldTex, coord + vec2<i32>(0, i32(params.relativeCellSize.y * f32(dims.y))), 0).rgb;

    let newMag = vec3<f32>(
      alphaBeta.x * mag.x - alphaBeta.y * (elYP.z - el.z),
      alphaBeta.x * mag.y - alphaBeta.y * (el.z - elXP.z),
      alphaBeta.x * mag.z - alphaBeta.y * ((elXP.y - el.y) - (elYP.x - el.x))
    );

    textureStore(outTex, coord, vec4<f32>(newMag, 0.0));
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

  struct SourceParams {
    dt: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
  };
  @group(0) @binding(2) var<uniform> params: SourceParams;

  @group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let coord = vec2<i32>(gid.xy);
    
    let source = textureLoad(sourceFieldTex, coord, 0);
    let field = textureLoad(fieldTex, coord, 0);

    textureStore(outTex, coord, field + params.dt * source);
  }
`;

const decaySource = `
  @group(0) @binding(0) var sourceFieldTex: texture_2d<f32>;

  struct DecayParams {
    dt: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
  };
  @group(0) @binding(1) var<uniform> params: DecayParams;

  @group(0) @binding(2) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let coord = vec2<i32>(gid.xy);
    
    let source = textureLoad(sourceFieldTex, coord, 0);
    let decayedSource = source * pow(0.1, params.dt);

    textureStore(outTex, coord, decayedSource);
  }
`;

const drawSquare = `
  @group(0) @binding(0) var inputTex: texture_2d<f32>;

  struct DrawParams {
    pos: vec2<f32>,
    size: vec2<f32>,
    value: vec4<f32>,
    keep: vec4<f32>,
  };
  @group(0) @binding(1) var<uniform> params: DrawParams;

  @group(0) @binding(2) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let coord = vec2<i32>(gid.xy);
    let uv = (vec2<f32>(coord) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    let d = abs(params.pos - uv);
    let oldValue = textureLoad(inputTex, coord, 0);
    let within = all(d <= params.size);

    let result = select(oldValue, params.value + params.keep * oldValue, within);
    textureStore(outTex, coord, result);
  }
`;

const drawEllipse = `
  @group(0) @binding(0) var inputTex: texture_2d<f32>;

  struct DrawParams {
    pos: vec2<f32>,
    radius: vec2<f32>,
    value: vec4<f32>,
    keep: vec4<f32>,
  };
  @group(0) @binding(1) var<uniform> params: DrawParams;

  @group(0) @binding(2) var outTex: texture_storage_2d<rgba32float, write>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
      return;
    }

    let coord = vec2<i32>(gid.xy);
    let uv = (vec2<f32>(coord) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dims);
    let d = (params.pos - uv) / params.radius;
    let distanceSquared = dot(d, d);
    let within = distanceSquared <= 1.0;
    
    let oldValue = textureLoad(inputTex, coord, 0);
    let result = select(oldValue, params.value + params.keep * oldValue, within);
    
    textureStore(outTex, coord, result);
  }
`;

// Add the missing point charge shader
// Point charge shader (reserved for future use)
/*
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
*/

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
  
  // Scale material values from [0,1] range back to physical values
  // Material texture stores normalized values that need to be scaled back
  let permittivity = (material.x - 0.5) * 8.0 + 1.0; // Scale around 1.0
  let permeability = (material.y - 0.5) * 8.0 + 1.0; // Scale around 1.0
  
  // Calculate energy densities (simplified from reference)
  let electricEnergy = electricEnergyFactor * permittivity * dot(electricField, electricField);
  let magneticEnergy = magneticEnergyFactor * permeability * dot(magneticField, magneticField);
  
  // Apply brightness scaling
  let brightnessSquared = brightness * brightness;
  let totalEnergy = brightnessSquared * (electricEnergy + magneticEnergy);
  
  // Simple bloom-like effect - extract bright areas
  let bloomThreshold = 0.1;
  let bloomValue = step(bloomThreshold, totalEnergy) * totalEnergy * 0.5;
  
  // Final color combining energy and bloom
  let finalIntensity = clamp(totalEnergy + bloomValue, 0.0, 1.0);
  
  // Color mapping: black -> blue -> cyan -> yellow -> white
  var color = vec3<f32>(0.0, 0.0, 0.0);
  if (finalIntensity > 0.001) {
    if (finalIntensity < 0.25) {
      // Black to blue
      color = vec3<f32>(0.0, 0.0, finalIntensity * 4.0);
    } else if (finalIntensity < 0.5) {
      // Blue to cyan
      color = vec3<f32>(0.0, (finalIntensity - 0.25) * 4.0, 1.0);
    } else if (finalIntensity < 0.75) {
      // Cyan to yellow
      color = vec3<f32>((finalIntensity - 0.5) * 4.0, 1.0, 1.0 - (finalIntensity - 0.5) * 4.0);
    } else {
      // Yellow to white
      let whiteAmount = (finalIntensity - 0.75) * 4.0;
      color = vec3<f32>(1.0, 1.0, whiteAmount);
    }
  }
  
  return vec4<f32>(color, 1.0);
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
  private alphaBetaDt: number = 0.001; // Track dt used for alpha-beta calculation

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
      try {
        console.log(`Creating shader module: ${name}`);
        const module = this.device.createShaderModule({
          code: shader,
          label: `${name}_shader_module`
        });

        // Check for compilation info
        const compilationInfo = await module.getCompilationInfo();
        if (compilationInfo.messages.length > 0) {
          console.log(`Shader ${name} compilation info:`, compilationInfo.messages);
          for (const message of compilationInfo.messages) {
            console.log(`  ${message.type}: ${message.message} at line ${message.lineNum}, pos ${message.linePos}`);
          }
        }

        const pipeline = this.device.createComputePipeline({
          layout: 'auto',
          compute: {
            module,
            entryPoint: 'main',
          },
          label: `${name}_pipeline`,
        });
        this.pipelines.set(name, pipeline);
      } catch (error) {
        console.error(`Error creating shader ${name}:`, error);
        console.log(`Shader code for ${name}:`, shader);
        throw error;
      }
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
    this.createTexture('materialField', this.textureSize, this.textureSize, 'rgba8unorm'); // Use widely supported filterable format
    this.createTexture('sourceField', this.textureSize, this.textureSize);
    this.createTexture('sourceFieldNext', this.textureSize, this.textureSize); // Add double buffer for source field

    // Initialize material properties (vacuum by default)
    this.initializeMaterialField();
    this.initializeAlphaBeta();
  }

  private initializeMaterialField() {
    // Initialize with vacuum properties
    // For rgba8unorm, we need to normalize values to [0,1] and scale in shader
    const materialData = new Uint8Array(this.textureSize * this.textureSize * 4);
    for (let i = 0; i < materialData.length; i += 4) {
      materialData[i] = 128; // permeability - neutral value, will scale in shader
      materialData[i + 1] = 128; // permittivity - neutral value, will scale in shader  
      materialData[i + 2] = 0; // conductivity (σ)
      materialData[i + 3] = 255; // unused - full alpha
    }

    this.device.queue.writeTexture(
      { texture: this.textures.get('materialField')! },
      materialData,
      { bytesPerRow: this.textureSize * 4 }, // rgba8unorm = 4 channels * 1 byte = 4 bytes per pixel
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
        { binding: 1, resource: { buffer: simBuffer } },
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
      ],
    });

    this.runComputePass('updateAlphaBeta', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));
  }

  createTexture(name: string, width: number, height: number, format: GPUTextureFormat = 'rgba32float') {
    const texture = this.device.createTexture({
      size: [width, height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      label: `${name}_texture`,
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
    console.log(`Adding charge: x=${x}, y=${y}, charge=${charge}`);

    const nx = (x + 1) * 0.5; // Convert from [-1,1] to [0,1]
    const ny = (y + 1) * 0.5;

    console.log(`Normalized position: nx=${nx}, ny=${ny}`);

    const drawParams = new Float32Array([
      nx, ny, // position in [0,1] space
      0.1, 0.1, // slightly larger radius for visibility
      0, 0, charge * 1000, 0, // much larger charge magnitude for debugging
      1, 1, 1, 1, // keep existing values (additive)
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
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('drawEllipse')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceField')!.createView() },
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('drawEllipse', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to source field
    this.copyTexture(tempTexture, this.textures.get('sourceField')!);
    tempTexture.destroy();
    paramsBuffer.destroy();

    console.log('Charge added successfully');
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

  // Main simulation step - Fixed to match reference implementation
  step() {
    const dt = this.dt;

    // Step electric field (first half of time step)
    this.stepElectric(dt);

    // Step magnetic field (second half of time step) 
    this.stepMagnetic(dt);
  }

  private stepElectric(dt: number) {
    // Update alpha-beta if needed
    this.updateAlphaBetaFromMaterial(dt);

    // Inject sources into electric field
    this.injectSources();

    // Decay sources
    this.decaySources();

    // Update electric field
    this.updateElectricField();

    // Advance time by half step
    this.time += dt / 2;
  }

  private stepMagnetic(dt: number) {
    // Update magnetic field  
    this.updateMagneticField();

    // Advance time by half step
    this.time += dt / 2;
  }

  private updateAlphaBetaFromMaterial(dt: number) {
    // Only update if dt changed
    if (this.alphaBetaDt !== dt) {
      this.alphaBetaDt = dt;

      const simParams = new Float32Array([dt, this.cellSize, 0, 0]);
      const simBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(simBuffer, 0, simParams);

      const bindGroup = this.device.createBindGroup({
        layout: this.pipelines.get('updateAlphaBeta')!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.textures.get('materialField')!.createView() },
          { binding: 1, resource: { buffer: simBuffer } },
          { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        ],
      });

      this.runComputePass('updateAlphaBeta', bindGroup,
        Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

      simBuffer.destroy();
    }
  }

  private updateElectricField() {
    // Swap electric field buffers before writing
    this.swapElectricBuffers();

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
        { binding: 0, resource: this.textures.get('electricFieldNext')!.createView() }, // Previous electric field
        { binding: 1, resource: this.textures.get('magneticField')!.createView() }, // Current magnetic field
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        { binding: 3, resource: { buffer: paramsBuffer } },
        { binding: 4, resource: this.textures.get('electricField')!.createView() }, // Write to current
      ],
    });

    this.runComputePass('updateElectric', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    paramsBuffer.destroy();
  }

  private updateMagneticField() {
    // Swap magnetic field buffers before writing
    this.swapMagneticBuffers();

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
        { binding: 0, resource: this.textures.get('electricField')!.createView() }, // Current electric field
        { binding: 1, resource: this.textures.get('magneticFieldNext')!.createView() }, // Previous magnetic field
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        { binding: 3, resource: { buffer: paramsBuffer } },
        { binding: 4, resource: this.textures.get('magneticField')!.createView() }, // Write to current
      ],
    });

    this.runComputePass('updateMagnetic', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    paramsBuffer.destroy();
  }

  private injectSources() {
    // Swap source field buffers
    this.swapSourceBuffers();

    const sourceParams = new Float32Array([this.dt, 0, 0, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, sourceParams);

    // Create temporary texture for output
    const tempTexture = this.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('injectSource')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceFieldNext')!.createView() }, // Previous source field
        { binding: 1, resource: this.textures.get('electricFieldNext')!.createView() }, // Previous electric field
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('injectSource', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to current electric field
    this.copyTexture(tempTexture, this.textures.get('electricField')!);
    tempTexture.destroy();
    paramsBuffer.destroy();
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
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('decaySource')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceFieldNext')!.createView() }, // Previous source field
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('decaySource', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to current source field
    this.copyTexture(tempTexture, this.textures.get('sourceField')!);
    tempTexture.destroy();
    paramsBuffer.destroy();
  }

  private swapSourceBuffers() {
    // Swap source field buffers
    const temp = this.textures.get('sourceField');
    this.textures.set('sourceField', this.textures.get('sourceFieldNext')!);
    this.textures.set('sourceFieldNext', temp!);
  }

  private swapElectricBuffers() {
    // Swap electric field buffers
    const temp = this.textures.get('electricField');
    this.textures.set('electricField', this.textures.get('electricFieldNext')!);
    this.textures.set('electricFieldNext', temp!);
  }

  private swapMagneticBuffers() {
    // Swap magnetic field buffers
    const temp = this.textures.get('magneticField');
    this.textures.set('magneticField', this.textures.get('magneticFieldNext')!);
    this.textures.set('magneticFieldNext', temp!);
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
const setupFDTDRenderPipeline = async (_fdtdSim: FDTDSimulation, gpuDevice: GPUDevice) => {
  // Get or create the canvas element
  let canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fdtd-canvas';
    canvas.width = 512;
    canvas.height = 512;
    // Fix canvas styling
    canvas.style.position = 'fixed';
    canvas.style.top = '50%';
    canvas.style.left = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    canvas.style.border = '1px solid #ccc';
    canvas.style.zIndex = '1000';
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
    code: fieldVertShader,
    label: 'field_vertex_shader'
  });

  const fragmentModule = gpuDevice.createShaderModule({
    code: fieldFragShader,
    label: 'field_fragment_shader'
  });

  // Create explicit bind group layout to avoid auto-layout issues
  renderBindGroupLayout = gpuDevice.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: 'unfilterable-float',
          viewDimension: '2d',
        },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: 'unfilterable-float',
          viewDimension: '2d',
        },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: 'float',
          viewDimension: '2d',
        },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: 'uniform',
        },
      },
    ],
    label: 'render_bind_group_layout',
  });

  const pipelineLayout = gpuDevice.createPipelineLayout({
    bindGroupLayouts: [renderBindGroupLayout],
    label: 'render_pipeline_layout',
  });

  renderPipeline = gpuDevice.createRenderPipeline({
    layout: pipelineLayout,
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
    label: 'field_render_pipeline',
  });

  renderConfigBuffer = gpuDevice.createBuffer({
    size: 16, // 4 floats for vec4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: 'render_config_buffer',
  });

  return context;
};

// Initialize WebGPU with FDTD simulation
const initializeWebGPUWithFDTD = async () => {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter not found');
  }

  const device = await adapter.requestDevice({
    label: 'FDTD Simulation Device',
    requiredFeatures: [],
    requiredLimits: {},
  });

  // Add error event listener for debugging
  device.addEventListener('uncapturederror', (event) => {
    console.error('WebGPU uncaptured error:', event.error);
  });

  const fdtdSim = new FDTDSimulation(device);

  await fdtdSim.initializePipelines();
  fdtdSim.initializeTextures();

  return { device, fdtdSim };
};// Update FDTD render function
const updateFDTDRender = (context: GPUCanvasContext, simulation: FDTDSimulation) => {
  // Get all required textures
  const electricFieldTexture = simulation.getTexture('electricField');
  const magneticFieldTexture = simulation.getTexture('magneticField');
  const materialTexture = simulation.getTexture('materialField');

  if (!electricFieldTexture || !magneticFieldTexture || !materialTexture) {
    console.log('Missing required textures for rendering');
    return;
  }

  // Config values: brightness, electricEnergyFactor, magneticEnergyFactor, time
  const configData = new Float32Array([
    10.0, // brightness - increased for better visibility
    0.5,  // electricEnergyFactor
    0.5,  // magneticEnergyFactor
    simulation.getTime(), // time
  ]);

  device.queue.writeBuffer(renderConfigBuffer, 0, configData);

  const bindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      { binding: 0, resource: electricFieldTexture.createView() },
      { binding: 1, resource: magneticFieldTexture.createView() },
      { binding: 2, resource: materialTexture.createView() },
      { binding: 3, resource: { buffer: renderConfigBuffer } },
    ],
    label: 'render_bind_group',
  }); const commandEncoder = device.createCommandEncoder();
  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, bindGroup);
  renderPass.draw(6);
  renderPass.end();

  device.queue.submit([commandEncoder.finish()]);
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

    // Add a test charge at startup
    setTimeout(() => {
      console.log('Adding test charge...');
      fdtdSimulation.addPointCharge(0, 0, 1.0);
    }, 1000);

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
const animate = () => {
  try {
    if (fdtdSimulation && renderContext && device) {
      // Run FDTD simulation step
      fdtdSimulation.step();

      // Render the results
      updateFDTDRender(renderContext, fdtdSimulation);
    }
    requestAnimationFrame(animate);
  } catch (error) {
    console.error('Animation loop error:', error);
    // Stop animation loop on error to prevent spam
  }
};

const ChargeCanvas = () => {
  React.useEffect(() => {
    initialize();

    // Add click handler for adding charges
    const handleClick = (event: MouseEvent) => {
      if (fdtdSimulation) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas && event.target === canvas) { // Only handle clicks on canvas
          const rect = canvas.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
          console.log(`Adding charge at (${x}, ${y})`); // Debug log
          fdtdSimulation.addPointCharge(x, y, 1.0);
        }
      }
    };

    // Add to canvas specifically rather than document
    setTimeout(() => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.addEventListener('click', handleClick);
      }
    }, 1000); // Wait for canvas to be created

    return () => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.removeEventListener('click', handleClick);
      }
      if (fdtdSimulation) {
        fdtdSimulation.destroy();
      }
    };
  }, []);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        color: '#666',
        fontSize: '14px',
        position: 'absolute',
        top: '20px'
      }}>
        Click on the canvas to add point charges
      </div>
    </div>
  );
};

export default ChargeCanvas;