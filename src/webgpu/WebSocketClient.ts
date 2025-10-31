import { ProtocolDecoder, ProtocolEncoder, MessageType, ControlType } from '../protocol/Protocol';
import type { FrameData, ErrorData } from '../protocol/Protocol';

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string | null = null;
  private onFrameCallback: ((data: FrameData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            this.handleBinaryMessage(event.data);
          } else {
            this.handleTextMessage(event.data);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          if (this.onErrorCallback) {
            this.onErrorCallback('WebSocket connection error');
          }
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleBinaryMessage(data: ArrayBuffer) {
    try {
      const decoder = new ProtocolDecoder(data);
      const messageType = decoder.decodeHeader();

      if (messageType === MessageType.SERVER_FRAME) {
        const frameData = decoder.decodeFrame();
        if (this.onFrameCallback) {
          this.onFrameCallback(frameData);
        }
      } else if (messageType === MessageType.SERVER_ERROR) {
        const errorData = decoder.decodeError();
        if (this.onErrorCallback) {
          this.onErrorCallback(errorData.message);
        }
      }
    } catch (error) {
      console.error('Error decoding binary message:', error);
    }
  }

  private handleTextMessage(data: string) {
    try {
      const message = JSON.parse(data);
      if (message.type === 'session') {
        this.sessionId = message.sessionId;
        console.log('Session ID received:', this.sessionId);
      }
    } catch (error) {
      console.error('Error parsing text message:', error);
    }
  }

  sendInput(x: number, y: number, z: number, value: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send input');
      return;
    }

    const encoder = new ProtocolEncoder();
    encoder.encodeClientInput(x, y, z, value);
    const buffer = encoder.getBuffer();
    this.ws.send(buffer);
  }

  sendControl(type: ControlType, parameter: number = 0) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send control');
      return;
    }

    const encoder = new ProtocolEncoder();
    encoder.encodeClientControl(type, parameter);
    const buffer = encoder.getBuffer();
    this.ws.send(buffer);
  }

  onFrame(callback: (data: FrameData) => void) {
    this.onFrameCallback = callback;
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      if (this.onErrorCallback) {
        this.onErrorCallback('Connection lost. Please refresh the page.');
      }
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}