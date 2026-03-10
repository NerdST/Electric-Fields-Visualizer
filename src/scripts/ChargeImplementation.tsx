import React from 'react';
import { FDTDSimulation } from '../simulation';
import type { OscillatingSource } from '../simulation';
import { initializeWebGPUWithFDTD, setupFDTDRenderPipeline, updateFDTDRender } from '../webgpu';

// Global variables
let device: GPUDevice;
let fdtdSimulation: FDTDSimulation;
let renderContext: GPUCanvasContext;
let renderPipeline: GPURenderPipeline;
let renderConfigBuffer: GPUBuffer;

// Simulation state
let simulationSpeed = 1024; // Steps per second
let simulationTimer: number | null = null;
let simulationStepCount = 0; // Track total simulation steps
// Store all static point charges as [x, y, charge] tuples
const staticCharges: Array<[number, number, number]> = [];
const CELL_SIZE_OPTIONS_NM = [1, 2, 5, 10, 20, 50, 100];
const STATIC_FIELD_STAMP = 1.0;
const OSCILLATING_FIELD_STAMP = 0.1;
const OSCILLATING_PHASE_STEP_RAD = 0.2;
const TWO_PI = Math.PI * 2;

const nmToMeters = (valueNm: number) => valueNm * 1e-9;

const formatSimTime = (seconds: number) => {
  const absSeconds = Math.abs(seconds);
  if (absSeconds >= 1) return `${seconds.toFixed(6)} s`;
  if (absSeconds >= 1e-3) return `${(seconds * 1e3).toFixed(6)} ms`;
  if (absSeconds >= 1e-6) return `${(seconds * 1e6).toFixed(6)} µs`;
  if (absSeconds >= 1e-9) return `${(seconds * 1e9).toFixed(6)} ns`;
  if (absSeconds >= 1e-12) return `${(seconds * 1e12).toFixed(6)} ps`;
  if (absSeconds >= 1e-15) return `${(seconds * 1e15).toFixed(6)} fs`;
  return `${seconds.toExponential(3)} s`;
};

const applyCanvasZoom = (zoomLevel: number, textureSize: number) => {
  const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  const clampedZoom = Math.max(1, Math.min(12, zoomLevel));
  const canvasPixels = Math.round(textureSize * clampedZoom);
  canvas.style.width = `${canvasPixels}px`;
  canvas.style.height = `${canvasPixels}px`;
};

// Updated initialization - Fixed device scope and error handling
const initialize = async (initialCellSize: number, initialZoom: number) => {
  try {
    console.log('Initializing WebGPU with FDTD...');
    const { device: gpuDevice, fdtdSim } = await initializeWebGPUWithFDTD();
    device = gpuDevice; // Set global device reference
    fdtdSimulation = fdtdSim;
    fdtdSimulation.setCellSize(initialCellSize);

    console.log('WebGPU and FDTD initialized successfully');

    // Setup render pipeline for FDTD - pass device explicitly
    const renderSetup = await setupFDTDRenderPipeline(device, fdtdSim.getTextureSize());
    renderContext = renderSetup.context;
    renderPipeline = renderSetup.renderPipeline;
    renderConfigBuffer = renderSetup.renderConfigBuffer;
    applyCanvasZoom(initialZoom, fdtdSim.getTextureSize());

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
          counterElement.textContent = `Step: ${simulationStepCount} | t: ${formatSimTime(fdtdSimulation.getTime())}`;
        }
      }
    } catch (error) {
      console.error('Simulation step error:', error);
    }
  };

  // Run simulation at fixed rate
  simulationTimer = window.setInterval(simStep, 1000 / simulationSpeed);
};

const pauseSimulationLoop = () => {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
    console.log('Simulation paused');
  }
};

const resumeSimulationLoop = () => {
  if (!simulationTimer) {
    startSimulationLoop();
    console.log('Simulation resumed');
  }
};

// Helper function to stamp a static point charge into the persistent source field.
// The source shader then enforces this as a fixed-field constraint each step.
const injectStaticCharge = async (position: [number, number], charge: number) => {
  const gridSize = fdtdSimulation.getTextureSize();
  const pixelRadius = 2.0 / gridSize; // 2 pixels for better visibility

  // Store static Ez value in z and write a hard-constraint mask in w.
  const drawParams = new Float32Array([
    position[0], position[1], // position in [0,1] space
    pixelRadius, pixelRadius, // radius
    0, 0, charge * STATIC_FIELD_STAMP, 1,
    0, 0, 1, 0, // accumulate Ez, force mask to 1 in stamped area
  ]);

  const paramsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, drawParams);

  // Stamp each ping-pong source buffer independently.
  const targets: Array<'sourceField' | 'sourceFieldNext'> = ['sourceField', 'sourceFieldNext'];
  for (const targetName of targets) {
    const targetTexture = fdtdSimulation.getTexture(targetName);
    if (!targetTexture) continue;

    const tempTexture = device.createTexture({
      size: [gridSize, gridSize],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = device.createBindGroup({
      layout: fdtdSimulation.getPipeline('drawEllipse')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: targetTexture.createView() },
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: tempTexture.createView() },
      ],
    });

    fdtdSimulation.runComputePass('drawEllipse', bindGroup, Math.ceil(gridSize / 8), Math.ceil(gridSize / 8));

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      { texture: tempTexture },
      { texture: targetTexture },
      [gridSize, gridSize]
    );
    device.queue.submit([commandEncoder.finish()]);
    tempTexture.destroy();
  }

  // Ensure GPU has finished before cleaning up
  await device.queue.onSubmittedWorkDone();
  paramsBuffer.destroy();
};

// Separate render loop (runs every frame)
const startRenderLoop = () => {
  const render = () => {
    try {
      if (fdtdSimulation && renderContext && device) {
        updateFDTDRender(renderContext, fdtdSimulation, device, renderPipeline, renderConfigBuffer);
      }
    } catch (error) {
      console.error('Render loop error:', error);
    } finally {
      requestAnimationFrame(render);
    }
  };

  requestAnimationFrame(render);
};

const ChargeCanvas = () => {
  // Probe position in normalized [0, 1] space (matches texture coordinates)
  const [probeX, setProbeX] = React.useState(0.5);
  const [probeY, setProbeY] = React.useState(0.5);
  const [fieldValue, setFieldValue] = React.useState<{ Ex: number, Ey: number, Ez: number, magnitude: number } | null>(null);
  const [sourceType, setSourceType] = React.useState<'static' | 'oscillating'>('static');
  const [oscFrequencyInput, setOscFrequencyInput] = React.useState('1e15');
  const [cellSizeNm, setCellSizeNm] = React.useState(5);
  const [zoomLevel, setZoomLevel] = React.useState(4);
  const sourceTypeRef = React.useRef<'static' | 'oscillating'>('static');
  const oscFrequencyRef = React.useRef('1e15');

  React.useEffect(() => {
    oscFrequencyRef.current = oscFrequencyInput;
  }, [oscFrequencyInput]);

  // Initialize simulation once on mount
  React.useEffect(() => {
    initialize(nmToMeters(cellSizeNm), zoomLevel);

    // Add mouse handler to place static point charges on click
    const handleMouseClick = (event: MouseEvent) => {
      if (fdtdSimulation) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas && event.target === canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width; // [0, 1]
          const y = 1 - ((event.clientY - rect.top) / rect.height); // [0, 1] with y-flip

          // Move the probe to the latest source placement so field readback is immediate.
          // setProbeX(x);
          // setProbeY(y);

          if (sourceTypeRef.current === 'static') {
            // Add persistent static charge constraint
            injectStaticCharge([x, y], 1.0);
            staticCharges.push([x, y, 1.0]);
            console.log(`Added static charge at (${x}, ${y}), total charges: ${staticCharges.length}`);
          } else {
            const gridSize = fdtdSimulation.getTextureSize();
            const pixelRadius = 2.0 / gridSize;
            const dt = Math.max(fdtdSimulation.getTimeStep(), 1e-30);
            const fallbackFrequencyHz = OSCILLATING_PHASE_STEP_RAD / (TWO_PI * dt);
            const parsedFrequency = Number(oscFrequencyRef.current);
            const oscillatorFrequencyHz = Number.isFinite(parsedFrequency) && parsedFrequency > 0
              ? parsedFrequency
              : fallbackFrequencyHz;
            const oscillatingSource: OscillatingSource = {
              position: [x, y],
              radius: pixelRadius,
              amplitude: OSCILLATING_FIELD_STAMP / dt,
              frequency: oscillatorFrequencyHz,
              phase: 0.0,
            };
            fdtdSimulation.addOscillatingSource(oscillatingSource);
            console.log(`Added oscillating source at (${x}, ${y}) with f=${oscillatorFrequencyHz} Hz`);
          }
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

  React.useEffect(() => {
    if (fdtdSimulation) {
      fdtdSimulation.setCellSize(nmToMeters(cellSizeNm));
    }
  }, [cellSizeNm]);

  React.useEffect(() => {
    const textureSize = fdtdSimulation ? fdtdSimulation.getTextureSize() : 128;
    applyCanvasZoom(zoomLevel, textureSize);
  }, [zoomLevel]);

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
    console.log('Pausing simulation to avoid race conditions...');

    // Pause simulation during tests to avoid concurrent texture access
    pauseSimulationLoop();

    // Wait a moment for any pending GPU work to complete
    await device.queue.onSubmittedWorkDone();

    try {
      const { FDTDTests } = await import('../tests/FDTDTests');
      const tester = new FDTDTests(device, fdtdSimulation);
      await tester.runAllTests();
    } finally {
      console.log('Tests complete, resuming simulation...');
      resumeSimulationLoop();
    }
  };

  // Add center charge for testing
  const addCenterCharge = () => {
    staticCharges.length = 0; // Clear existing charges
    fdtdSimulation.clearStaticSources();
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
        Click to add {sourceType === 'static' ? 'static' : 'oscillating'} sources
      </div>
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        display: 'flex',
        gap: '15px',
        alignItems: 'center'
      }}>
        <div id="step-counter" style={{
          color: '#2196F3',
          fontSize: '16px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          padding: '8px 12px',
          borderRadius: '4px',
          border: '1px solid #2196F3'
        }}>
          🔄 Step: 0
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#333',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          padding: '6px 8px',
          borderRadius: '4px',
          border: '1px solid #ccc'
        }}>
          <label htmlFor="source-type">Source:</label>
          <select
            id="source-type"
            value={sourceType}
            onChange={(event) => {
              const nextType = event.target.value as 'static' | 'oscillating';
              setSourceType(nextType);
              sourceTypeRef.current = nextType;
            }}
            style={{
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '2px 4px'
            }}
          >
            <option value="static">Static</option>
            <option value="oscillating">Oscillating</option>
          </select>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#333',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          padding: '6px 8px',
          borderRadius: '4px',
          border: '1px solid #ccc'
        }}>
          <label htmlFor="osc-frequency">f (Hz):</label>
          <input
            id="osc-frequency"
            type="text"
            inputMode="decimal"
            value={oscFrequencyInput}
            onChange={(event) => setOscFrequencyInput(event.target.value)}
            disabled={sourceType !== 'oscillating'}
            style={{
              width: '90px',
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '2px 4px'
            }}
            title="Oscillating source frequency in Hz. Scientific notation is supported (e.g. 1e3)."
          />
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#333',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          padding: '6px 8px',
          borderRadius: '4px',
          border: '1px solid #ccc'
        }}>
          <label htmlFor="cell-size">Cell:</label>
          <select
            id="cell-size"
            value={cellSizeNm}
            onChange={(event) => setCellSizeNm(Number(event.target.value))}
            style={{
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '2px 4px'
            }}
          >
            {CELL_SIZE_OPTIONS_NM.map((option) => (
              <option key={option} value={option}>{option} nm</option>
            ))}
          </select>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#333',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          padding: '6px 8px',
          borderRadius: '4px',
          border: '1px solid #ccc'
        }}>
          <label htmlFor="canvas-zoom">Zoom: {zoomLevel.toFixed(1)}x</label>
          <input
            id="canvas-zoom"
            type="range"
            min="1"
            max="12"
            step="0.5"
            value={zoomLevel}
            onChange={(event) => setZoomLevel(Number(event.target.value))}
          />
        </div>
        {/* <div style={{
          fontSize: '11px',
          color: '#666',
          fontFamily: 'monospace',
          padding: '4px 8px',
          backgroundColor: 'rgba(0, 200, 83, 0.1)',
          borderRadius: '3px',
          border: '1px solid #00C853'
        }}>
          ♾️ Infinite Ping-Pong Buffers
        </div> */}
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
        <div style={{ marginBottom: '8px' }}>
          <strong>Physical Mode</strong>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
            Δx: {cellSizeNm} nm | Δt: {fdtdSimulation ? formatSimTime(fdtdSimulation.getTimeStep()) : '...'}
          </div>
        </div>
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