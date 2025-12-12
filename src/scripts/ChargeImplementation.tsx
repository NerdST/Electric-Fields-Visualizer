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
let simulationSpeed = 1024; // Steps per second
let simulationTimer: number | null = null;
let simulationStepCount = 0; // Track total simulation steps
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
    const renderSetup = await setupFDTDRenderPipeline(device, fdtdSim.getTextureSize());
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
        // Static charges are injected once when added, not every step
        // This prevents infinite accumulation

        fdtdSimulation.step();
        simulationStepCount++;

        // Update counter display
        const counterElement = document.getElementById('step-counter');
        if (counterElement) {
          counterElement.textContent = `Step: ${simulationStepCount}`;
        }
      }
    } catch (error) {
      console.error('Simulation step error:', error);
    }
  };

  // Run simulation at fixed rate
  simulationTimer = window.setInterval(simStep, 1000 / simulationSpeed);
};

// Helper function to inject a static point charge into the source field
const injectStaticCharge = async (position: [number, number], charge: number) => {
  const gridSize = fdtdSimulation.getTextureSize();
  const pixelRadius = 2.0 / gridSize; // 2 pixels for better visibility

  // Inject charge once with proper magnitude
  const drawParams = new Float32Array([
    position[0], position[1], // position in [0,1] space
    pixelRadius, pixelRadius, // radius
    0, 0, charge * 10.0, 0, // z-component value (higher since injected once)
    0, 0, 1, 1, // Replace mode: set value (don't accumulate)
  ]);

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, drawParams);

  const tempTexture = device.createTexture({
    size: [gridSize, gridSize],
    format: 'rgba16float',
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

  // Copy result back into both current and next source textures (double buffer)
  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyTextureToTexture(
    { texture: tempTexture },
    { texture: fdtdSimulation.getTexture('sourceField')! },
    [gridSize, gridSize]
  );
  const nextSourceTex = fdtdSimulation.getTexture('sourceFieldNext');
  if (nextSourceTex) {
    commandEncoder.copyTextureToTexture(
      { texture: tempTexture },
      { texture: nextSourceTex },
      [gridSize, gridSize]
    );
  }
  device.queue.submit([commandEncoder.finish()]);
  // Ensure GPU has finished before cleaning up
  await device.queue.onSubmittedWorkDone();

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
  // Probe position in normalized [0, 1] space (matches texture coordinates)
  const [probeX, setProbeX] = React.useState(0.5);
  const [probeY, setProbeY] = React.useState(0.5);
  const [fieldValue, setFieldValue] = React.useState<{ Ex: number, Ey: number, Ez: number, magnitude: number } | null>(null);

  // Initialize simulation once on mount
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

          // Inject charge once immediately
          injectStaticCharge([x, y], 1.0);
          staticCharges.push([x, y, 1.0]);
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

  // Separate effect for reading probe values when position changes
  React.useEffect(() => {
    const readProbeValue = async () => {
      if (fdtdSimulation) {
        try {
          // Coordinates are already in [0,1] space - pass directly
          const data = await fdtdSimulation.readFieldValueAt(probeX, probeY);
          setFieldValue({
            Ex: data[0],
            Ey: data[1],
            Ez: data[2],
            magnitude: data[3]
          });
        } catch (error) {
          console.error('Error reading field value:', error);
        }
      }
    };

    // Read probe value every 100ms
    const probeTimer = setInterval(readProbeValue, 100);

    return () => {
      clearInterval(probeTimer);
    };
  }, [probeX, probeY]);

  // Test runner function
  const runTests = async () => {
    if (!fdtdSimulation || !device) {
      console.error('Simulation not initialized');
      return;
    }

    console.log('Starting FDTD accuracy tests...');
    const { FDTDTests } = await import('../tests/FDTDTests');
    const tester = new FDTDTests(device, fdtdSimulation);
    await tester.runAllTests();
  };

  // Add center charge for testing
  const addCenterCharge = () => {
    staticCharges.length = 0; // Clear existing charges
    injectStaticCharge([0.5, 0.5], 1.0); // Inject once immediately
    staticCharges.push([0.5, 0.5, 1.0]);
    console.log('Added test charge at center (0.5, 0.5)');
  };

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
        Click to add static point charges
      </div>
      <div id="step-counter" style={{
        color: '#666',
        fontSize: '14px',
        position: 'absolute',
        top: '45px',
        fontFamily: 'monospace'
      }}>
        Step: 0
      </div>
      <div style={{
        position: 'absolute',
        top: '70px',
        left: '20px',
        color: '#666',
        fontSize: '12px',
        fontFamily: 'monospace',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: '10px',
        borderRadius: '5px',
        border: '1px solid #ccc',
        minWidth: '200px'
      }}>
        <div><strong>Probe Position (0 to 1):</strong></div>
        <div style={{ marginTop: '5px' }}>
          <label>X: </label>
          <input
            type="number"
            value={probeX}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) setProbeX(Math.max(0, Math.min(1, val)));
            }}
            step="0.01"
            min="0"
            max="1"
            style={{ width: '80px', marginLeft: '5px' }}
          />
        </div>
        <div style={{ marginTop: '5px' }}>
          <label>Y: </label>
          <input
            type="number"
            value={probeY}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) setProbeY(Math.max(0, Math.min(1, val)));
            }}
            step="0.01"
            min="0"
            max="1"
            style={{ width: '80px', marginLeft: '5px' }}
          />
        </div>
        <div style={{ marginTop: '10px', fontSize: '10px', color: '#999' }}>
          Texture coords: ({probeX.toFixed(3)}, {probeY.toFixed(3)})
        </div>
        <div style={{ marginTop: '8px' }}><strong>Electric Field:</strong></div>
        {fieldValue ? (
          <>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#2196F3', marginTop: '4px' }}>
              Ez: {fieldValue.Ez.toExponential(3)}
            </div>
            <div style={{ fontSize: '10px', color: '#999', marginTop: '8px' }}>
              <div>Ex: {fieldValue.Ex.toExponential(3)} (≈0 for 2D)</div>
              <div>Ey: {fieldValue.Ey.toExponential(3)} (≈0 for 2D)</div>
            </div>
          </>
        ) : (
          <div>Reading...</div>
        )}
        <div style={{ marginTop: '12px', borderTop: '1px solid #ddd', paddingTop: '10px' }}>
          <button
            onClick={addCenterCharge}
            style={{
              padding: '6px 12px',
              marginRight: '5px',
              cursor: 'pointer',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              fontSize: '11px'
            }}
          >
            Add Center Charge
          </button>
          <button
            onClick={runTests}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              fontSize: '11px'
            }}
          >
            Run Tests
          </button>
        </div>
      </div>
      {/* Probe position indicator overlay */}
      <div
        id="probe-indicator"
        style={{
          position: 'absolute',
          left: `${probeX * 100}%`,
          top: `${(1 - probeY) * 100}%`,
          width: '12px',
          height: '12px',
          marginLeft: '-6px',
          marginTop: '-6px',
          borderRadius: '50%',
          border: '2px solid #ff0000',
          backgroundColor: 'rgba(255, 0, 0, 0.3)',
          pointerEvents: 'none',
          zIndex: 1000
        }}
      />
    </div>
  );
};

export default ChargeCanvas;