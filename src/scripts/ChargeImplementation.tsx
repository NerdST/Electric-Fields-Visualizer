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
// Store all static point charges as [x, y, charge] tuples
const staticCharges: Array<[number, number, number]> = [];

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
        // Inject all static charges every step
        for (const [x, y, charge] of staticCharges) {
          injectStaticCharge([x, y], charge);
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

// Helper function to inject a static point charge into the source field
const injectStaticCharge = (position: [number, number], charge: number) => {
  const gridSize = fdtdSimulation.getTextureSize();
  const pixelRadius = 1.0 / gridSize; // Single pixel

  const drawParams = new Float32Array([
    position[0], position[1], // position in [0,1] space
    pixelRadius, pixelRadius, // radius (1 pixel)
    0, 0, charge, 0, // z-component value (charge magnitude)
    0, 0, 1, 1, // Replace mode: set to charge value (don't accumulate)
  ]);

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, drawParams);

  const tempTexture = device.createTexture({
    size: [gridSize, gridSize],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });

  const bindGroup = device.createBindGroup({
    layout: fdtdSimulation.getPipeline('drawEllipse')!.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: fdtdSimulation.getTexture('sourceField')!.createView() },
      { binding: 1, resource: { buffer: paramsBuffer } },
      { binding: 2, resource: tempTexture.createView() },
    ],
  });

  fdtdSimulation.runComputePass('drawEllipse', bindGroup, Math.ceil(gridSize / 8), Math.ceil(gridSize / 8));

  // Copy result back
  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyTextureToTexture(
    { texture: tempTexture },
    { texture: fdtdSimulation.getTexture('sourceField')! },
    [gridSize, gridSize]
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

    // Add mouse handler to place static point charges on click
    const handleMouseClick = (event: MouseEvent) => {
      if (fdtdSimulation) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas && event.target === canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width; // [0, 1]
          const y = 1 - ((event.clientY - rect.top) / rect.height); // [0, 1] with y-flip

          // Add a static point charge with charge = 1
          staticCharges.push([x, y, 0.01]);
          console.log(`Added static charge at (${x}, ${y}), total charges: ${staticCharges.length}`);
        }
      }
    };

    // Add event listeners after canvas is created
    setTimeout(() => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.addEventListener('click', handleMouseClick);
      }
    }, 1000);

    return () => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.removeEventListener('click', handleMouseClick);
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
        Click to add static point charges (charge = 1)
      </div>
    </div>
  );
};

export default ChargeCanvas;