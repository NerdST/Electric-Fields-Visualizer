import { FDTDSimulation } from '../simulation';
import { loadAllShaders } from '../shaders';

// Initialize WebGPU with FDTD simulation
export const initializeWebGPUWithFDTD = async () => {
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

  const fdtdSim = new FDTDSimulation(device, 128);

  // Load and initialize shaders
  const shaders = loadAllShaders();
  await fdtdSim.initializePipelines(shaders.compute);
  fdtdSim.initializeTextures();

  return { device, fdtdSim };
};

// Setup render pipeline for FDTD
export const setupFDTDRenderPipeline = async (gpuDevice: GPUDevice, textureSize: number) => {
  // Get or create the canvas element
  let canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fdtd-canvas';
    canvas.width = textureSize;
    canvas.height = textureSize;
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

  // Load render shaders
  const shaders = loadAllShaders();
  const vertexModule = gpuDevice.createShaderModule({
    code: shaders.render.fieldVertex,
    label: 'field_vertex_shader'
  });

  const fragmentModule = gpuDevice.createShaderModule({
    code: shaders.render.fieldFragment,
    label: 'field_fragment_shader'
  });

  // Create explicit bind group layout to avoid auto-layout issues
  const renderBindGroupLayout = gpuDevice.createBindGroupLayout({
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

  const renderPipeline = gpuDevice.createRenderPipeline({
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

  const renderConfigBuffer = gpuDevice.createBuffer({
    size: 16, // 4 floats for vec4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: 'render_config_buffer',
  });

  return { context, renderPipeline, renderBindGroupLayout, renderConfigBuffer };
};

// Update FDTD render function
export const updateFDTDRender = (
  context: GPUCanvasContext,
  simulation: FDTDSimulation,
  device: GPUDevice,
  renderPipeline: GPURenderPipeline,
  renderBindGroupLayout: GPUBindGroupLayout,
  renderConfigBuffer: GPUBuffer
) => {
  // Get all required textures
  const electricFieldTexture = simulation.getTexture('electricField');
  const magneticFieldTexture = simulation.getTexture('magneticField');
  const materialTexture = simulation.getTexture('materialField');

  if (!electricFieldTexture || !magneticFieldTexture || !materialTexture) {
    console.log('Missing required textures for rendering');
    return;
  }

  // Config values: brightness, electricEnergyFactor, magneticEnergyFactor, time
  // Balanced brightness for visibility without oversaturation
  const cellSize = 0.01; // Match simulation cellSize
  const brightnessBase = 0.1; // Balanced value for good visibility
  const brightness = (brightnessBase * brightnessBase) / (cellSize * cellSize);

  const configData = new Float32Array([
    brightness, // brightness calculated from cellSize
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
  });

  const commandEncoder = device.createCommandEncoder();
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
