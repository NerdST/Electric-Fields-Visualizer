import * as THREE from 'three';
import { electricFieldAt } from '../Charge';
import type { Charge, ElectricFieldResult } from '../Charge';
import type { SimulationProvider, SimulationMode, SimulationStats } from './SimulationProvider';
import type { StorageMode } from '../FDTDSimulation';

type Bounds = { min: THREE.Vector3; max: THREE.Vector3 };

const DEFAULT_BOUNDS: Bounds = {
    min: new THREE.Vector3(-5, -5, -5),
    max: new THREE.Vector3(5, 5, 5),
};

type RemoteStats = {
    stepsPerSecond: number;
    totalSteps: number;
    time: number;
    dt: number;
    usingGpu: boolean;
    paused: boolean;
    targetSps: number;
};

/** Milliseconds between batch sample flushes (one WebSocket message per frame tick). */
const BATCH_INTERVAL_MS = 16;

/**
 * SimulationProvider that delegates FDTD computation to a remote server via WebSocket.
 * Implements the same stale-while-revalidate caching pattern as FDTDSimulationProvider.
 *
 * Protocol: see cloud/fdtd_server.py
 */
export class RemoteSimulationProvider implements SimulationProvider {
    public readonly mode: SimulationMode = 'remote';

    private ws: WebSocket | null = null;
    private readonly serverUrl: string;
    private readonly bounds: Bounds;
    private charges: Charge[] = [];
    private disposed = false;

    private readonly sampleCache = new Map<string, ElectricFieldResult>();
    // Tracks the world-space position for every key that has been cached,
    // so invalidateFieldCache() can re-enqueue them all without clearing stale values.
    private readonly cachedPositions = new Map<string, THREE.Vector3>();
    private readonly pendingBatch = new Map<string, THREE.Vector3>();
    private batchTimer: number | null = null;
    private requestIdCounter = 0;
    private readonly inflightRequests = new Map<number, { keys: string[]; positions: THREE.Vector3[] }>();

    private remoteStats: RemoteStats = {
        stepsPerSecond: 0,
        totalSteps: 0,
        time: 0,
        dt: 0,
        usingGpu: false,
        paused: false,
        targetSps: 240,
    };

    private _paused = false;
    private _targetSps = 240;
    private _connected = false;

    /** Whether the WebSocket is currently connected. */
    public get connected(): boolean {
        return this._connected;
    }

    constructor(serverUrl: string, bounds: Bounds = DEFAULT_BOUNDS) {
        this.serverUrl = serverUrl;
        this.bounds = bounds;
        this._connect();
    }

    // ------------------------------------------------------------------
    // SimulationProvider interface
    // ------------------------------------------------------------------

    public setCharges(charges: Charge[]): void {
        this.charges = [...charges];
        this.sampleCache.clear();
        this.cachedPositions.clear();
        this._sendCharges();
    }

    public upsertCharge(charge: Charge): void {
        const index = this.charges.findIndex((c) => c.id === charge.id);
        if (index >= 0) {
            this.charges[index] = charge;
        } else {
            this.charges.push(charge);
        }
        this.sampleCache.clear();
        this.cachedPositions.clear();
        this._sendCharges();
    }

    public removeCharge(chargeId: string): void {
        this.charges = this.charges.filter((c) => c.id !== chargeId);
        this.sampleCache.clear();
        this.cachedPositions.clear();
        this._sendCharges();
    }

    public clearCharges(): void {
        this.charges = [];
        this.sampleCache.clear();
        this.cachedPositions.clear();
        this._sendCharges();
    }

    public setSimulationPaused(paused: boolean): void {
        this._paused = paused;
        this._send({ type: 'set_paused', paused });
    }

    public setTargetStepsPerSecond(stepsPerSecond: number): void {
        this._targetSps = stepsPerSecond;
        this._send({ type: 'set_steps_per_second', value: stepsPerSecond });
    }

    public sampleFieldAt(position: THREE.Vector3): ElectricFieldResult {
        const key = this._cacheKey(position);

        const cached = this.sampleCache.get(key);
        if (cached) {
            return cached;
        }

        // Return analytical fallback immediately, queue remote sample
        const fallback = electricFieldAt(position, this.charges);
        this.sampleCache.set(key, fallback);
        this.cachedPositions.set(key, position.clone());
        this._enqueueSample(key, position);
        return fallback;
    }

    public samplePotentialAt(position: THREE.Vector3): number {
        return electricFieldAt(position, this.charges).potential;
    }

    public getStats(): SimulationStats {
        return {
            mode: this.mode,
            ready: this._connected,
            usingFallback: !this._connected,
            paused: this._paused,
            storageMode: '2d' as StorageMode,
            targetStepsPerSecond: this._targetSps,
            steps: this.remoteStats.totalSteps,
            stepsPerSecond: this.remoteStats.stepsPerSecond,
            dt: this.remoteStats.dt,
            sampleCacheSize: this.sampleCache.size,
        };
    }

    public invalidateFieldCache(): void {
        // Re-enqueue every known position without clearing stale values.
        // Stale data continues to render until fresh server response arrives.
        for (const [key, pos] of this.cachedPositions) {
            this.pendingBatch.set(key, pos);
        }
        if (this.pendingBatch.size > 0 && this.batchTimer === null) {
            this.batchTimer = window.setTimeout(() => {
                this.batchTimer = null;
                this._flushBatch();
            }, BATCH_INTERVAL_MS);
        }
    }

    public dispose(): void {
        this.disposed = true;
        if (this.batchTimer !== null) {
            window.clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.sampleCache.clear();
        this.cachedPositions.clear();
        this.pendingBatch.clear();
        this.inflightRequests.clear();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // ------------------------------------------------------------------
    // WebSocket management
    // ------------------------------------------------------------------

    private _connect(): void {
        if (this.disposed) return;
        try {
            const ws = new WebSocket(this.serverUrl);
            ws.binaryType = 'arraybuffer';
            this.ws = ws;

            ws.addEventListener('open', () => {
                this._connected = true;
                // Re-send current state on reconnect
                this._sendCharges();
                this._send({ type: 'set_paused', paused: this._paused });
                this._send({ type: 'set_steps_per_second', value: this._targetSps });
            });

            ws.addEventListener('message', (ev) => {
                try {
                    const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
                    this._handleMessage(msg);
                } catch {
                    // Ignore malformed messages
                }
            });

            ws.addEventListener('close', () => {
                this._connected = false;
                this.ws = null;
                // Reconnect after 3s if not disposed
                if (!this.disposed) {
                    window.setTimeout(() => this._connect(), 3000);
                }
            });

            ws.addEventListener('error', () => {
                // close event fires after error, reconnect handled there
            });
        } catch {
            if (!this.disposed) {
                window.setTimeout(() => this._connect(), 3000);
            }
        }
    }

    private _send(msg: object): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    private _sendCharges(): void {
        if (!this._connected) return;
        const payload = this.charges.map((c) => ({
            id: c.id,
            x: c.position.x,
            y: c.position.y,
            z: c.position.z,
            magnitude: c.magnitude,
        }));
        this._send({ type: 'set_charges', charges: payload });
    }

    private _handleMessage(msg: Record<string, unknown>): void {
        const t = msg.type as string;

        if (t === 'field_sample') {
            const requestId = msg.requestId as number;
            const fields = msg.fields as number[][];
            const inflight = this.inflightRequests.get(requestId);
            if (!inflight || !fields) return;
            this.inflightRequests.delete(requestId);

            for (let i = 0; i < inflight.keys.length && i < fields.length; i++) {
                const [ex, ey, ez] = fields[i];
                const pos = inflight.positions[i];
                const potential = electricFieldAt(pos, this.charges).potential;
                this.sampleCache.set(inflight.keys[i], {
                    field: new THREE.Vector3(ex, ey, ez),
                    potential,
                });
            }
        } else if (t === 'stats') {
            this.remoteStats = {
                stepsPerSecond: (msg.stepsPerSecond as number) ?? 0,
                totalSteps: (msg.totalSteps as number) ?? 0,
                time: (msg.time as number) ?? 0,
                dt: (msg.dt as number) ?? 0,
                usingGpu: (msg.usingGpu as boolean) ?? false,
                paused: (msg.paused as boolean) ?? false,
                targetSps: (msg.targetSps as number) ?? 240,
            };
        }
    }

    // ------------------------------------------------------------------
    // Batched sampling
    // ------------------------------------------------------------------

    private _enqueueSample(key: string, position: THREE.Vector3): void {
        if (!this._connected) return;
        this.pendingBatch.set(key, position);

        if (this.batchTimer === null) {
            this.batchTimer = window.setTimeout(() => {
                this.batchTimer = null;
                this._flushBatch();
            }, BATCH_INTERVAL_MS);
        }
    }

    private _flushBatch(): void {
        if (this.pendingBatch.size === 0 || !this._connected) return;

        const keys: string[] = [];
        const positions: THREE.Vector3[] = [];
        const normalized: [number, number, number][] = [];

        for (const [key, pos] of this.pendingBatch) {
            keys.push(key);
            positions.push(pos);
            normalized.push([
                this._normalize(pos).x,
                this._normalize(pos).y,
                this._normalize(pos).z,
            ]);
        }
        this.pendingBatch.clear();

        const requestId = ++this.requestIdCounter;
        this.inflightRequests.set(requestId, { keys, positions });
        this._send({ type: 'sample', requestId, positions: normalized });
    }

    // ------------------------------------------------------------------
    // Coordinate helpers (mirrors SimulationProvider.ts exactly)
    // ------------------------------------------------------------------

    private _normalize(position: THREE.Vector3): THREE.Vector3 {
        const size = this.bounds.max.clone().sub(this.bounds.min);
        const n = position.clone().sub(this.bounds.min);
        return new THREE.Vector3(
            THREE.MathUtils.clamp(n.x / Math.max(size.x, 1e-6), 0, 1),
            THREE.MathUtils.clamp(n.y / Math.max(size.y, 1e-6), 0, 1),
            THREE.MathUtils.clamp(n.z / Math.max(size.z, 1e-6), 0, 1),
        );
    }

    private _cacheKey(position: THREE.Vector3): string {
        const n = this._normalize(position);
        return `r:${n.x.toFixed(3)}:${n.y.toFixed(3)}:${n.z.toFixed(3)}`;
    }
}
