import { WebSocketClient, FrameData } from '../webgpu/WebSocketClient';

export class RemoteFDTD {
  private client: WebSocketClient;
  private electricFieldTexture: GPUTexture | null = null;
  private magneticFieldTexture: GPUTexture | null = null;
  private device: GPUDevice;
  private simulationTime: number = 0;
  public onFrame: ((frameData: FrameData) => void) | null = null;
  public onError: ((error: string) => void) | null = null;

  constructor(device: GPUDevice, serverUrl?: string) {
    this.device = device;
    this.client = new WebSocketClient(serverUrl);

    this.client.onFrame((frameData: FrameData) => {
      this.handleFrame(frameData);
      if (this.onFrame) {
        this.onFrame(frameData);
      }
    });

    this.client.onError((error: string) => {
      console.error('Remote FDTD error:', error);
      if (this.onError) {
        this.onError(error);
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  private async handleFrame(frameData: FrameData) {
    this.simulationTime = frameData.simulationTime;

    // Create textures from received data
    await this.updateTextures(frameData.electricField, frameData.magneticField);
  }

  private async updateTextures(electricData: ArrayBuffer, magneticData: ArrayBuffer) {
    // Create textures from the received frame data
    // This assumes the data is in RGBA32Float format

    const width = 128; // Should match backend
    const height = 128;
    const depth = 128;
    const size = width * height * depth * 3 * 4; // 3 components, 4 bytes per float

    // Electric field texture
    if (!this.electricFieldTexture) {
      this.electricFieldTexture = this.device.createTexture({
        size: [width, height, depth],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }

    // Magnetic field texture
    if (!this.magneticFieldTexture) {
      this.magneticFieldTexture = this.device.createTexture({
        size: [width, height, depth],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }

    // Upload data to GPU
    this.device.queue.writeTexture(
      { texture: this.electricFieldTexture },
      electricData,
      { bytesPerRow: width * 3 * 4, rowsPerImage: height },
      { width, height, depth }
    );

    this.device.queue.writeTexture(
      { texture: this.magneticFieldTexture },
      magneticData,
      { bytesPerRow: width * 3 * 4, rowsPerImage: height },
      { width, height, depth }
    );
  }

  sendInput(x: number, y: number, z: number, value: number) {
    if (this.isConnected()) {
      this.client.sendInput(x, y, z, value);
    }
  }

  getElectricFieldTexture(): GPUTexture | null {
    return this.electricFieldTexture;
  }

  getMagneticFieldTexture(): GPUTexture | null {
    return this.magneticFieldTexture;
  }

  getTime(): number {
    return this.simulationTime;
  }

  disconnect() {
    this.client.disconnect();
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }
}
