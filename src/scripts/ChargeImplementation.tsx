// import * as THREE from 'three';

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

const fieldVertShader = `
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}
`;

const fieldFragShader = `
@group(0) @binding(0) var<storage, read> fieldOutput: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> renderConfig: vec4<f32>; // x: gridSize, y: maxPotential, z: minPotential, w: screenWidth

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let gridSize = u32(renderConfig.x);
    let maxPotential = renderConfig.y;
    let minPotential = renderConfig.z;
    let screenWidth = renderConfig.w;
    
    // Map fragment coordinates to grid coordinates
    let screenX = fragCoord.x / screenWidth;
    let screenY = fragCoord.y / (screenWidth * 0.75); // Adjust for aspect ratio
    
    let gridX = u32(screenX * f32(gridSize - 1u));
    let gridY = u32((1.0 - screenY) * f32(gridSize - 1u)); // Flip Y
    
    if (gridX >= gridSize || gridY >= gridSize) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    
    let index = gridY * gridSize + gridX;
    if (index >= arrayLength(&fieldOutput)) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    
    let potential = fieldOutput[index].w;

    // Normalize potential relative to zero point
    let maxAbsPotential = max(abs(maxPotential), abs(minPotential));
    let normalizedPotential = potential / maxAbsPotential;
    
    // Create gradient: red for positive, blue for negative, black for zero
    var red = 0.0;
    var green = 0.0;
    var blue = 0.0;
    
    if (normalizedPotential > 0.0) {
        // Positive potential -> red
        red = normalizedPotential;
    } else if (normalizedPotential < 0.0) {
        // Negative potential -> blue
        blue = -normalizedPotential;
    }
    // Zero potential stays black (0, 0, 0)
    
    return vec4<f32>(red, green, blue, 1.0);
}
`;

// Initialize WebGPU
if (!navigator.gpu) {
  throw new Error("WebGPU not supported on this browser.");
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("Failed to get GPU adapter");

const device = await adapter.requestDevice();
if (!device) throw new Error("Failed to get GPU device");

const module = device.createShaderModule({ code: pointChargeShader });

const pipeline = device.createComputePipeline({
  label: 'Point Charge Electric Field Pipeline',
  layout: 'auto',
  compute: {
    module,
    entryPoint: 'main',
  },
})

// Grid configuration
const gridSize = 100; // Increased for better resolution
const spacing = 0.1;

// Create buffers for GPU computation
const createBuffers = () => {
  const chargesData = new Float32Array([
    -1, 0, 0, 1e-9,  // charge at (-1,0,0) with magnitude 1 nanocoulomb
    1, 0, 0, -1e-9,  // charge at (1,0,0) with magnitude -1 nanocoulomb
  ]);

  const chargesBuffer = device.createBuffer({
    size: Math.max(chargesData.byteLength, 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(chargesBuffer, 0, chargesData);

  const gridConfigData = new Float32Array([gridSize, gridSize, 1, spacing]);
  const gridConfigBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(gridConfigBuffer, 0, gridConfigData);

  const fieldOutputBuffer = device.createBuffer({
    size: gridSize * gridSize * 4 * 4, // vec4<f32>
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: chargesBuffer } },
      { binding: 1, resource: { buffer: gridConfigBuffer } },
      { binding: 2, resource: { buffer: fieldOutputBuffer } },
    ],
  });

  return { chargesBuffer, gridConfigBuffer, fieldOutputBuffer, bindGroup };
};

// Get screen dimensions
const getScreenDimensions = () => {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
};

// Create fullscreen canvas
const canvas = document.createElement('canvas');
const { width, height } = getScreenDimensions();
canvas.width = width;
canvas.height = height;
canvas.style.position = 'fixed';
canvas.style.top = '0';
canvas.style.left = '0';
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.zIndex = '1';
canvas.style.cursor = 'crosshair';
document.body.appendChild(canvas);

// Text display for potential value
const textDiv = document.createElement('div');
textDiv.style.position = 'fixed';
textDiv.style.top = '10px';
textDiv.style.left = '10px';
textDiv.style.color = 'white';
textDiv.style.fontFamily = 'monospace';
textDiv.style.fontSize = '16px';
textDiv.style.background = 'rgba(0,0,0,0.8)';
textDiv.style.padding = '15px';
textDiv.style.borderRadius = '8px';
textDiv.style.zIndex = '1000';
textDiv.style.border = '1px solid rgba(255,255,255,0.3)';
textDiv.style.backdropFilter = 'blur(10px)';
textDiv.style.display = 'none';
document.body.appendChild(textDiv);

// FPS Counter
const fpsDiv = document.createElement('div');
fpsDiv.style.position = 'fixed';
fpsDiv.style.top = '10px';
fpsDiv.style.right = '10px';
fpsDiv.style.color = '#00ff88';
fpsDiv.style.fontFamily = 'monospace';
fpsDiv.style.fontSize = '14px';
fpsDiv.style.fontWeight = 'bold';
fpsDiv.style.background = 'rgba(0,0,0,0.8)';
fpsDiv.style.padding = '10px';
fpsDiv.style.borderRadius = '8px';
fpsDiv.style.zIndex = '1000';
fpsDiv.style.border = '1px solid rgba(0,255,136,0.3)';
fpsDiv.style.backdropFilter = 'blur(10px)';
fpsDiv.style.minWidth = '120px';
fpsDiv.style.textAlign = 'center';
fpsDiv.innerHTML = 'FPS: --';
document.body.appendChild(fpsDiv);

// Performance monitoring
class PerformanceMonitor {
  private frameCount = 0;
  private lastTime = 0;
  private fps = 0;
  private frameTime = 0;
  private frameTimes: number[] = [];
  private maxSamples = 60;

  update(currentTime: number) {
    if (this.lastTime === 0) {
      this.lastTime = currentTime;
      return;
    }

    // Calculate frame time
    this.frameTime = currentTime - this.lastTime;
    this.frameTimes.push(this.frameTime);

    // Keep only recent samples
    if (this.frameTimes.length > this.maxSamples) {
      this.frameTimes.shift();
    }

    this.frameCount++;
    this.lastTime = currentTime;

    // Update FPS every 10 frames for stability
    if (this.frameCount % 10 === 0) {
      const avgFrameTime = this.frameTimes.reduce((sum, time) => sum + time, 0) / this.frameTimes.length;
      this.fps = Math.round(1000 / avgFrameTime);

      // Calculate min/max frame times for additional info
      const minFrameTime = Math.min(...this.frameTimes);
      const maxFrameTime = Math.max(...this.frameTimes);
      const minFps = Math.round(1000 / maxFrameTime);
      const maxFps = Math.round(1000 / minFrameTime);

      this.updateDisplay(avgFrameTime, minFps, maxFps);
    }
  }

  private updateDisplay(avgFrameTime: number, minFps: number, maxFps: number) {
    const fpsColor = this.fps >= 55 ? '#00ff88' : this.fps >= 30 ? '#ffaa00' : '#ff4444';

    fpsDiv.innerHTML = `
      <div style="color: ${fpsColor}; font-size: 16px; margin-bottom: 4px;">
        FPS: ${this.fps}
      </div>
      <div style="font-size: 11px; color: #aaa;">
        Frame: ${avgFrameTime.toFixed(1)}ms
      </div>
      <div style="font-size: 10px; color: #666;">
        Range: ${minFps}-${maxFps}
      </div>
    `;
  }

  getFPS() {
    return this.fps;
  }

  getFrameTime() {
    return this.frameTime;
  }
}

const performanceMonitor = new PerformanceMonitor();

// GPU computation and field data
const { chargesBuffer, gridConfigBuffer, fieldOutputBuffer, bindGroup } = createBuffers();
let fieldData: Float32Array;

// Compute field values
const computeField = async () => {
  const commandEncoder = device.createCommandEncoder();
  const computePass = commandEncoder.beginComputePass();
  computePass.setPipeline(pipeline);
  computePass.setBindGroup(0, bindGroup);
  computePass.dispatchWorkgroups(Math.ceil((gridSize * gridSize) / 64));
  computePass.end();

  const readBuffer = device.createBuffer({
    size: fieldOutputBuffer.size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  commandEncoder.copyBufferToBuffer(fieldOutputBuffer, 0, readBuffer, 0, fieldOutputBuffer.size);
  device.queue.submit([commandEncoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const arrayBuffer = readBuffer.getMappedRange();
  fieldData = new Float32Array(arrayBuffer.slice(0));
  readBuffer.unmap();

  console.log('Field computation complete. Field data length:', fieldData.length);
};

// Get potential at screen coordinates
const getPotentialAtScreenPoint = (screenX: number, screenY: number) => {
  if (!fieldData) return 0;

  // Convert screen coordinates to grid coordinates
  const normalizedX = screenX / canvas.width;
  const normalizedY = 1.0 - (screenY / canvas.height); // Flip Y

  const gridX = Math.round(normalizedX * (gridSize - 1));
  const gridY = Math.round(normalizedY * (gridSize - 1));

  if (gridX < 0 || gridX >= gridSize || gridY < 0 || gridY >= gridSize) return 0;

  const index = gridY * gridSize + gridX;
  if (index * 4 + 3 >= fieldData.length) return 0;

  return fieldData[index * 4 + 3] || 0;
};

// Convert screen coordinates to world coordinates
const screenToWorld = (screenX: number, screenY: number) => {
  const normalizedX = (screenX / canvas.width) * 2 - 1; // [-1, 1]
  const normalizedY = 1 - (screenY / canvas.height) * 2; // [1, -1] (flipped)

  // Map to world coordinates (-5 to 5 range)
  const worldX = normalizedX * 5;
  const worldY = normalizedY * 5;

  return { x: worldX, y: worldY };
};

// Mouse interaction
const onMouseMove = (event: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;

  const worldPos = screenToWorld(screenX, screenY);
  const potential = getPotentialAtScreenPoint(screenX, screenY);
  const fps = performanceMonitor.getFPS();
  const frameTime = performanceMonitor.getFrameTime();

  textDiv.innerHTML = `
    <div style="margin-bottom: 8px; font-weight: bold; color: #00ff88;">Electric Field Visualizer</div>
    <div>Position: (${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)})</div>
    <div>Potential: ${potential.toFixed(6)} V</div>
    <div style="margin-top: 8px; font-size: 12px; color: #aaa;">
      Red = High Potential | Blue = Low Potential
    </div>
    <div style="margin-top: 8px; font-size: 11px; color: #666; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
      Performance: ${fps} FPS (${frameTime.toFixed(1)}ms)
    </div>
  `;
  textDiv.style.display = 'block';
};

const onMouseLeave = () => {
  textDiv.style.display = 'none';
};

canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseleave', onMouseLeave);

// WebGPU rendering setup
let renderPipeline: GPURenderPipeline;
let renderBindGroup: GPUBindGroup;
let renderConfigBuffer: GPUBuffer;
let renderContext: GPUCanvasContext;

const setupRenderPipeline = async () => {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPU context not available');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
  });

  const vertexModule = device.createShaderModule({
    code: fieldVertShader
  });

  const fragmentModule = device.createShaderModule({
    code: fieldFragShader
  });

  renderPipeline = device.createRenderPipeline({
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

  renderConfigBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  return context;
};

// Update render function
const updateRender = (context: GPUCanvasContext) => {
  if (!fieldData || !renderPipeline) return;

  const renderStart = performance.now();

  const { width } = getScreenDimensions();

  // Calculate min/max potential for normalization
  let minPotential = Infinity;
  let maxPotential = -Infinity;

  for (let i = 3; i < fieldData.length; i += 4) {
    const potential = fieldData[i];
    if (isFinite(potential)) {
      minPotential = Math.min(minPotential, potential);
      maxPotential = Math.max(maxPotential, potential);
    }
  }

  // Update render config
  const renderConfigData = new Float32Array([gridSize, maxPotential, minPotential, width]);
  device.queue.writeBuffer(renderConfigBuffer, 0, renderConfigData);

  // Create bind group
  renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: fieldOutputBuffer } },
      { binding: 1, resource: { buffer: renderConfigBuffer } },
    ],
  });

  // Render
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
  renderPass.setBindGroup(0, renderBindGroup);
  renderPass.draw(6);
  renderPass.end();

  device.queue.submit([commandEncoder.finish()]);

  const renderEnd = performance.now();
  const renderTime = renderEnd - renderStart;

  // Optional: Log render times for debugging
  if (performanceMonitor.getFPS() < 30) {
    console.log(`Slow frame detected: ${renderTime.toFixed(2)}ms render time`);
  }
};

// Handle window resize
const handleResize = () => {
  const { width, height } = getScreenDimensions();
  canvas.width = width;
  canvas.height = height;
};

window.addEventListener('resize', handleResize);

// Animation loop with performance monitoring
const animate = (currentTime: number = performance.now()) => {
  requestAnimationFrame(animate);

  // Update performance monitor
  performanceMonitor.update(currentTime);

  if (renderContext && fieldData) {
    updateRender(renderContext);
  }
};

// Initialize with performance logging
computeField().then(async () => {
  console.log('Field computation complete. Starting render loop...');
  renderContext = await setupRenderPipeline();
  animate();
}).catch(error => {
  console.error('Error computing field:', error);
});

const ChargeCanvas = () => {
  return <div style={{ margin: 0, padding: 0, overflow: 'hidden' }} />;
};

export default ChargeCanvas;