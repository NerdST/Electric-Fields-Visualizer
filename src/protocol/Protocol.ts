// Frontend protocol encoder/decoder matching C++ backend

export enum MessageType {
  CLIENT_INPUT = 0x01,
  CLIENT_CONTROL = 0x02,
  SERVER_FRAME = 0x10,
  SERVER_STATE = 0x11,
  SERVER_ERROR = 0x12,
}

export enum ControlType {
  PAUSE = 0x01,
  RESUME = 0x02,
  RESET = 0x03,
  SET_SPEED = 0x04,
}

export interface FrameData {
  sessionId: string;
  simulationTime: number;
  electricField: ArrayBuffer;
  magneticField: ArrayBuffer;
}

export interface ErrorData {
  sessionId: string;
  message: string;
}

export class ProtocolEncoder {
  private buffer: Uint8Array;
  private offset: number;

  constructor(initialSize: number = 1024) {
    this.buffer = new Uint8Array(initialSize);
    this.offset = 0;
  }

  private ensureCapacity(additionalBytes: number) {
    if (this.offset + additionalBytes > this.buffer.length) {
      const newSize = Math.max(this.buffer.length * 2, this.offset + additionalBytes);
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
  }

  private writeUint8(value: number) {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = value;
  }

  private writeUint32(value: number) {
    this.ensureCapacity(4);
    const view = new DataView(this.buffer.buffer, this.offset);
    view.setUint32(0, value, true); // little-endian
    this.offset += 4;
  }

  private writeFloat32(value: number) {
    this.ensureCapacity(4);
    const view = new DataView(this.buffer.buffer, this.offset);
    view.setFloat32(0, value, true); // little-endian
    this.offset += 4;
  }

  private writeString(str: string) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeUint32(bytes.length);
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  encodeClientInput(x: number, y: number, z: number, value: number) {
    this.offset = 0;
    this.writeUint8(MessageType.CLIENT_INPUT);
    this.writeFloat32(x);
    this.writeFloat32(y);
    this.writeFloat32(z);
    this.writeFloat32(value);
    this.writeUint32(Date.now());
  }

  encodeClientControl(type: ControlType, parameter: number) {
    this.offset = 0;
    this.writeUint8(MessageType.CLIENT_CONTROL);
    this.writeUint8(type);
    this.writeFloat32(parameter);
  }

  getBuffer(): ArrayBuffer {
    return this.buffer.buffer.slice(0, this.offset);
  }
}

export class ProtocolDecoder {
  private data: Uint8Array;
  private offset: number;

  constructor(buffer: ArrayBuffer) {
    this.data = new Uint8Array(buffer);
    this.offset = 0;
  }

  private readUint8(): number {
    if (this.offset >= this.data.length) {
      throw new Error('Buffer underflow');
    }
    return this.data[this.offset++];
  }

  private readUint32(): number {
    if (this.offset + 4 > this.data.length) {
      throw new Error('Buffer underflow');
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset);
    const value = view.getUint32(0, true); // little-endian
    this.offset += 4;
    return value;
  }

  private readFloat32(): number {
    if (this.offset + 4 > this.data.length) {
      throw new Error('Buffer underflow');
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset);
    const value = view.getFloat32(0, true); // little-endian
    this.offset += 4;
    return value;
  }

  private readFloat64(): number {
    if (this.offset + 8 > this.data.length) {
      throw new Error('Buffer underflow');
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset);
    const value = view.getFloat64(0, true); // little-endian
    this.offset += 8;
    return value;
  }

  private readString(): string {
    const length = this.readUint32();
    if (this.offset + length > this.data.length) {
      throw new Error('Buffer underflow');
    }
    const decoder = new TextDecoder();
    const str = decoder.decode(this.data.slice(this.offset, this.offset + length));
    this.offset += length;
    return str;
  }

  decodeHeader(): MessageType {
    return this.readUint8() as MessageType;
  }

  decodeFrame(): FrameData {
    const sessionId = this.readString();
    const simulationTime = this.readFloat64();
    const dataSize = this.readUint32();

    // Split the data: first half is electric field, second half is magnetic field
    const halfSize = dataSize / 2;
    const electricField = this.data.buffer.slice(this.offset, this.offset + halfSize);
    this.offset += halfSize;
    const magneticField = this.data.buffer.slice(this.offset, this.offset + halfSize);
    this.offset += halfSize;

    return {
      sessionId,
      simulationTime,
      electricField,
      magneticField,
    };
  }

  decodeError(): ErrorData {
    const sessionId = this.readString();
    const message = this.readString();
    return { sessionId, message };
  }
}
