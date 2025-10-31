import React, { useState, useEffect } from 'react';
import { RemoteFDTD } from '../simulation/RemoteFDTD';
import { setupFDTDRenderPipeline, updateFDTDRender } from '../webgpu';

// Configuration
const USE_REMOTE_SIMULATION = true; // Toggle between local and remote
const REMOTE_SERVER_URL = process.env.VITE_WS_URL || 'ws://localhost:8080';

interface ChargeCanvasProps {
  useRemote?: boolean;
  serverUrl?: string;
}

const ChargeCanvas: React.FC<ChargeCanvasProps> = ({
  useRemote = USE_REMOTE_SIMULATION,
  serverUrl = REMOTE_SERVER_URL
}) => {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Global variables for remote mode
  let device: GPUDevice | null = null;
  let remoteFDTD: RemoteFDTD | null = null;
  let renderContext: GPUCanvasContext | null = null;
  let renderPipeline: GPURenderPipeline | null = null;
  let renderConfigBuffer: GPUBuffer | null = null;
  let renderBindGroupLayout: GPUBindGroupLayout | null = null;
  let materialTexture: GPUTexture | null = null;

  // Simulation state
  let mouseIsDown = false;
  let mouseDownPosition: [number, number] | null = null;
  const signalFrequency = 3; // Hz
  const signalBrushValue = 10; // Amplitude

  useEffect(() => {
    if (useRemote) {
      initializeRemote();
    } else {
      // Fallback to local simulation
      console.warn('Remote mode disabled, using local simulation');
    }

    return () => {
      if (remoteFDTD) {
        remoteFDTD.disconnect();
      }
    };
  }, [useRemote, serverUrl]);

  const initializeRemote = async () => {
    try {
      setConnectionStatus('connecting');

      // Initialize WebGPU device for rendering
      if (!navigator.gpu) {
        throw new Error('WebGPU not supported');
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('WebGPU adapter not found');
      }

      device = await adapter.requestDevice({
        label: 'FDTD Render Device',
        requiredFeatures: [],
        requiredLimits: {},
      });

      // Create remote FDTD client
      remoteFDTD = new RemoteFDTD(device, serverUrl);

      remoteFDTD.onFrame = (frameData) => {
        // Handle incoming frames
        console.log('Frame received:', frameData.simulationTime);
      };

      remoteFDTD.onError = (error) => {
        setErrorMessage(error);
        setConnectionStatus('error');
      };

      // Connect to server
      await remoteFDTD.connect();
      setConnectionStatus('connected');

      // Setup render pipeline
      const textureSize = 128; // Default size
      const renderSetup = await setupFDTDRenderPipeline(
        null, // No local simulation
        device,
        textureSize
      );
      renderContext = renderSetup.context;
      renderPipeline = renderSetup.renderPipeline;
      renderBindGroupLayout = renderSetup.renderBindGroupLayout;
      renderConfigBuffer = renderSetup.renderConfigBuffer;

      // Create material texture (default vacuum)
      materialTexture = device.createTexture({
        size: [textureSize, textureSize],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });

      // Initialize material (vacuum)
      const materialData = new Uint8Array(textureSize * textureSize * 4);
      for (let i = 0; i < materialData.length; i += 4) {
        materialData[i] = 255;     // permeability
        materialData[i + 1] = 255;  // permittivity
        materialData[i + 2] = 0;    // conductivity
        materialData[i + 3] = 255;  // alpha
      }
      device.queue.writeTexture(
        { texture: materialTexture },
        materialData,
        { bytesPerRow: textureSize * 4 },
        { width: textureSize, height: textureSize }
      );

      // Start render loop
      startRenderLoop();

    } catch (error) {
      console.error('Error initializing remote simulation:', error);
      setErrorMessage(String(error));
      setConnectionStatus('error');
    }
  };

  const startRenderLoop = () => {
    const render = () => {
      try {
        if (!renderContext || !renderPipeline || !device || !remoteFDTD) {
          requestAnimationFrame(render);
          return;
        }

        const electricTexture = remoteFDTD.getElectricFieldTexture();
        const magneticTexture = remoteFDTD.getMagneticFieldTexture();

        if (!electricTexture || !magneticTexture || !materialTexture) {
          requestAnimationFrame(render);
          return;
        }

        // Update render config
        const cellSize = 0.01;
        const brightnessBase = 0.02;
        const brightness = (brightnessBase * brightnessBase) / (cellSize * cellSize);

        const configData = new Float32Array([
          brightness,
          0.5,  // electricEnergyFactor
          0.5,  // magneticEnergyFactor
          remoteFDTD.getTime(),
        ]);

        device.queue.writeBuffer(renderConfigBuffer!, 0, configData);

        const bindGroup = device.createBindGroup({
          layout: renderBindGroupLayout!,
          entries: [
            { binding: 0, resource: electricTexture.createView() },
            { binding: 1, resource: magneticTexture.createView() },
            { binding: 2, resource: materialTexture.createView() },
            { binding: 3, resource: { buffer: renderConfigBuffer! } },
          ],
        });

        const commandEncoder = device.createCommandEncoder();
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: renderContext!.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });

        renderPass.setPipeline(renderPipeline!);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(6);
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
      } catch (error) {
        console.error('Render loop error:', error);
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  };

  // Mouse handlers
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (remoteFDTD && remoteFDTD.isConnected()) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas && event.target === canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = 1 - ((event.clientY - rect.top) / rect.height);
          mouseDownPosition = [x, y];
          mouseIsDown = true;

          // Send initial input
          const time = remoteFDTD.getTime();
          const value = -signalBrushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * time);
          remoteFDTD.sendInput(x, y, 0.5, value); // z = 0.5 for center slice
        }
      }
    };

    const handleMouseUp = () => {
      mouseIsDown = false;
      mouseDownPosition = null;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (mouseIsDown && remoteFDTD && remoteFDTD.isConnected()) {
        const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = 1 - ((event.clientY - rect.top) / rect.height);
          mouseDownPosition = [x, y];

          // Send continuous input
          const time = remoteFDTD.getTime();
          const value = -signalBrushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * time);
          remoteFDTD.sendInput(x, y, 0.5, value);
        }
      }
    };

    setTimeout(() => {
      const canvas = document.getElementById('fdtd-canvas');
      if (canvas) {
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mousemove', handleMouseMove);
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
    };
  }, [useRemote]);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Connection status indicator */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        padding: '10px',
        background: connectionStatus === 'connected' ? 'rgba(0, 255, 0, 0.3)' :
          connectionStatus === 'connecting' ? 'rgba(255, 255, 0, 0.3)' :
            'rgba(255, 0, 0, 0.3)',
        borderRadius: '5px',
        color: 'white',
        fontSize: '12px',
        fontFamily: 'monospace'
      }}>
        {connectionStatus === 'connected' && 'Connected to backend'}
        {connectionStatus === 'connecting' && 'Connecting...'}
        {connectionStatus === 'error' && `Error: ${errorMessage}`}
      </div>

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
