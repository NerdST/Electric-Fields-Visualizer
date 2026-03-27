import { FDTDSimulation } from './models/FDTDSimulation';
import { loadComputeShaders } from './models/loadShaders';

export async function initializeWebGPUWithFDTD(): Promise<{
    device: GPUDevice;
    fdtdSim: FDTDSimulation;
}> {
    if (!('gpu' in navigator)) {
        throw new Error('WebGPU is not supported in this browser');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('Failed to acquire a WebGPU adapter');
    }

    const device = await adapter.requestDevice();
    const fdtdSim = new FDTDSimulation(device);
    const computeShaders = await loadComputeShaders();
    await fdtdSim.initializePipelines(computeShaders);
    fdtdSim.initializeTextures();

    return { device, fdtdSim };
}

export async function setupFDTDRenderPipeline(
    device: GPUDevice,
    _textureSize: number,
): Promise<{
    context: GPUCanvasContext;
    renderPipeline: GPURenderPipeline;
    renderConfigBuffer: GPUBuffer;
}> {
    const canvas = document.getElementById('fdtd-canvas') as HTMLCanvasElement | null;
    if (!canvas) {
        throw new Error('Missing #fdtd-canvas element for FDTD rendering');
    }

    const context = canvas.getContext('webgpu');
    if (!context) {
        throw new Error('Failed to create WebGPU canvas context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'opaque',
    });

    const shaderModule = device.createShaderModule({
        code: `
struct VsOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VsOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out : VsOut;
  out.position = vec4<f32>(pos[vid], 0.0, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.02, 0.02, 0.02, 1.0);
}
`,
    });

    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format }],
        },
        primitive: {
            topology: 'triangle-list',
        },
    });

    const renderConfigBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    return {
        context,
        renderPipeline,
        renderConfigBuffer,
    };
}

export function updateFDTDRender(
    context: GPUCanvasContext,
    _fdtdSimulation: FDTDSimulation,
    device: GPUDevice,
    renderPipeline: GPURenderPipeline,
    _renderConfigBuffer: GPUBuffer,
): void {
    const textureView = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: textureView,
                clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    });

    pass.setPipeline(renderPipeline);
    pass.draw(3);
    pass.end();

    device.queue.submit([encoder.finish()]);
}
