import React from 'react';
import { FDTDSimulation } from '../simulation';
import { initializeWebGPUWithFDTD, setupFDTDRenderPipeline, updateFDTDRender } from '../webgpu';

// Global variables
let device: GPUDevice;
let fdtdSimulation: FDTDSimulation;
let renderContext: GPUCanvasContext;
let renderPipeline: GPURenderPipeline;
let renderConfigBuffer: GPUBuffer;
let renderBindGroupLayout: GPUBindGroupLayout;

// Simulation state
let simulationSpeed = 60; // Steps per second
let simulationTimer: number | null = null;
let mouseIsDown = false;
let mouseDownPosition: [number, number] | null = null;
const signalFrequency = 3; // Hz
const signalBrushValue = 10; // Amplitude
const signalBrushSize = 1; // Grid cells

// Updated initialization - Fixed device scope and error handling
const initialize = async () => {
  try {
    console.log('Initializing WebGPU with FDTD...');
    const { device: gpuDevice, fdtdSim } = await initializeWebGPUWithFDTD();
    device = gpuDevice; // Set global device reference
    fdtdSimulation = fdtdSim;

    console.log('WebGPU and FDTD initialized successfully');

    // Setup render pipeline for FDTD - pass device explicitly
    const renderSetup = await setupFDTDRenderPipeline(fdtdSimulation, device, fdtdSim.getTextureSize());
    renderContext = renderSetup.context;
    renderPipeline = renderSetup.renderPipeline;
    renderBindGroupLayout = renderSetup.renderBindGroupLayout;
    renderConfigBuffer = renderSetup.renderConfigBuffer;

    console.log('FDTD simulation ready. Starting loops...');

    // Start separate simulation and render loops
    startSimulationLoop();
    startRenderLoop();

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

// Separate simulation loop (fixed timestep)
const startSimulationLoop = () => {
  if (simulationTimer) {
    clearInterval(simulationTimer);
  }

  const simStep = () => {
    try {
      if (fdtdSimulation) {
        // Inject oscillating source if mouse is down (matching reference behavior)
        if (mouseIsDown && mouseDownPosition) {
          const gridSize = fdtdSimulation.getTextureSize(); // Match simulation textureSize
          const brushHalfSize: [number, number] = [
            signalBrushSize / gridSize / 2,
            signalBrushSize / gridSize / 2
          ];

          // Oscillating source matching reference: -signalBrushValue * 2000 * cos(2π * freq * time)
          const time = fdtdSimulation.getTime();
          const value = -signalBrushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * time);

          // Inject into source field
          injectOscillatingSource(mouseDownPosition, brushHalfSize, value);
        }

        fdtdSimulation.step();
      }
    } catch (error) {
      console.error('Simulation step error:', error);
    }
  };

  // Run simulation at fixed rate
  simulationTimer = window.setInterval(simStep, 1000 / simulationSpeed);
};

// Helper function to inject oscillating source
const injectOscillatingSource = (center: [number, number], halfSize: [number, number], value: number) => {
  const drawParams = new Float32Array([
    center[0], center[1], // position in [0,1] space
    halfSize[0], halfSize[1], // half size
    0, 0, value, 0, // z-component value (electromagnetic wave)
    1, 1, 1, 1, // keep existing values (additive)
  ]);

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, drawParams);

  const tempTexture = device.createTexture({
    size: [fdtdSimulation.getTextureSize(), fdtdSimulation.getTextureSize()],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });

  const bindGroup = device.createBindGroup({
    layout: fdtdSimulation.getPipeline('drawSquare')!.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: fdtdSimulation.getTexture('sourceField')!.createView() },
      { binding: 1, resource: { buffer: paramsBuffer } },
      { binding: 2, resource: tempTexture.createView() },
    ],
  });

  fdtdSimulation.runComputePass('drawSquare', bindGroup, Math.ceil(fdtdSimulation.getTextureSize() / 8), Math.ceil(fdtdSimulation.getTextureSize() / 8));

  // Copy result back
  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyTextureToTexture(
    { texture: tempTexture },
    { texture: fdtdSimulation.getTexture('sourceField')! },
    [fdtdSimulation.getTextureSize(), fdtdSimulation.getTextureSize()]
  );
  device.queue.submit([commandEncoder.finish()]);

  tempTexture.destroy();
  paramsBuffer.destroy();
};

// Separate render loop (runs every frame)
const startRenderLoop = () => {
  const render = () => {
    try {
      if (fdtdSimulation && renderContext && device) {
        updateFDTDRender(renderContext, fdtdSimulation, device, renderPipeline, renderBindGroupLayout, renderConfigBuffer);
      }
      requestAnimationFrame(render);
    } catch (error) {
      console.error('Render loop error:', error);
    }
  };

  requestAnimationFrame(render);
};

const ChargeCanvas = () => {
  React.useEffect(() => {
    initialize();

    // Add mouse handlers for continuous source injection (matching reference)
    const handleMouseDown = (event: MouseEvent) => {
      if (fdtdSimulation) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas && event.target === canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width; // [0, 1]
          const y = 1 - ((event.clientY - rect.top) / rect.height); // [0, 1] with y-flip
          mouseDownPosition = [x, y];
          mouseIsDown = true;
          console.log(`Mouse down at (${x}, ${y})`);
        }
      }
    };

    const handleMouseUp = () => {
      mouseIsDown = false;
      mouseDownPosition = null;
      console.log('Mouse up');
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (mouseIsDown && fdtdSimulation) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = 1 - ((event.clientY - rect.top) / rect.height);
          mouseDownPosition = [x, y];
        }
      }
    };

    // Add event listeners after canvas is created
    setTimeout(() => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mousemove', handleMouseMove);
        // Also handle mouse leaving canvas
        canvas.addEventListener('mouseleave', handleMouseUp);
      }
    }, 1000);

    return () => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseleave', handleMouseUp);
      }
      if (simulationTimer) {
        clearInterval(simulationTimer);
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
        Click and hold to create oscillating electromagnetic waves
      </div>
    </div>
  );
};

export default ChargeCanvas;