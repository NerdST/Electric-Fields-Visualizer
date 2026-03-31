import * as THREE from 'three';
import { electricFieldAt } from '../Charge';
import type { Charge, ElectricFieldResult } from '../Charge';
import { initializeWebGPUWithFDTD } from '../../webgpu';
import type { FDTDSimulation, StorageMode } from '../FDTDSimulation';
import { RemoteSimulationProvider } from './RemoteSimulationProvider';

export type SimulationMode = 'analytical' | 'fdtd' | 'remote';

export type SimulationStats = {
    mode: SimulationMode;
    ready: boolean;
    usingFallback: boolean;
    paused: boolean;
    storageMode: StorageMode;
    targetStepsPerSecond: number;
    steps: number;
    stepsPerSecond: number;
    dt: number;
    sampleCacheSize: number;
};

export interface SimulationProvider {
    readonly mode: SimulationMode;
    setCharges(charges: Charge[]): void;
    upsertCharge(charge: Charge): void;
    removeCharge(chargeId: string): void;
    clearCharges(): void;
    setSimulationPaused(paused: boolean): void;
    setTargetStepsPerSecond(stepsPerSecond: number): void;
    sampleFieldAt(position: THREE.Vector3): ElectricFieldResult;
    samplePotentialAt(position: THREE.Vector3): number;
    getStats(): SimulationStats;
    dispose(): void;
}

export class AnalyticalSimulationProvider implements SimulationProvider {
    public readonly mode: SimulationMode = 'analytical';
    private charges: Charge[] = [];

    public setCharges(charges: Charge[]): void {
        this.charges = charges;
    }

    public upsertCharge(charge: Charge): void {
        const index = this.charges.findIndex((c) => c.id === charge.id);
        if (index >= 0) {
            this.charges[index] = charge;
            return;
        }
        this.charges.push(charge);
    }

    public removeCharge(chargeId: string): void {
        this.charges = this.charges.filter((charge) => charge.id !== chargeId);
    }

    public clearCharges(): void {
        this.charges = [];
    }

    public setSimulationPaused(_paused: boolean): void {
        // No-op for analytical mode.
    }

    public setTargetStepsPerSecond(_stepsPerSecond: number): void {
        // No-op for analytical mode.
    }

    public sampleFieldAt(position: THREE.Vector3): ElectricFieldResult {
        return electricFieldAt(position, this.charges);
    }

    public samplePotentialAt(position: THREE.Vector3): number {
        return this.sampleFieldAt(position).potential;
    }

    public getStats(): SimulationStats {
        return {
            mode: this.mode,
            ready: true,
            usingFallback: false,
            paused: true,
            storageMode: '2d',
            targetStepsPerSecond: 0,
            steps: 0,
            stepsPerSecond: 0,
            dt: 0,
            sampleCacheSize: 0,
        };
    }

    public dispose(): void {
        this.charges = [];
    }
}

type Bounds = { min: THREE.Vector3; max: THREE.Vector3 };

const DEFAULT_BOUNDS: Bounds = {
    min: new THREE.Vector3(-5, -5, -5),
    max: new THREE.Vector3(5, 5, 5),
};

class FDTDSimulationProvider implements SimulationProvider {
    public readonly mode: SimulationMode = 'fdtd';
    private charges: Charge[] = [];
    private fdtdSimulation: FDTDSimulation | null = null;
    private readonly bounds: Bounds;
    private disposed = false;
    private readyPromise: Promise<void>;
    private readonly sampleCache = new Map<string, ElectricFieldResult>();
    private readonly pendingSamples = new Set<string>();
    private tickTimer: number | null = null;
    private lastTickTimeMs = 0;
    private accumulatorMs = 0;
    private totalSteps = 0;
    private stepsInWindow = 0;
    private stepsPerSecond = 0;
    private lastRateUpdateMs = 0;
    private targetStepsPerSecond = 240;
    private paused = false;
    private readonly storageMode: StorageMode;

    constructor(bounds: Bounds = DEFAULT_BOUNDS) {
        this.bounds = bounds;
        const requestedMode = window.localStorage.getItem('fdtd-storage-mode');
        this.storageMode = requestedMode === '3d' ? '3d' : '2d';
        this.readyPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            const { fdtdSim } = await initializeWebGPUWithFDTD({ storageMode: this.storageMode });
            if (this.disposed) {
                fdtdSim.destroy();
                return;
            }
            this.fdtdSimulation = fdtdSim;
            this.startTickLoop();
            this.rebuildStaticSources();
        } catch (error) {
            console.warn('FDTD provider initialization failed, using analytical fallback behavior.', error);
            this.fdtdSimulation = null;
        }
    }

    public setCharges(charges: Charge[]): void {
        this.charges = [...charges];
        void this.readyPromise.then(() => this.rebuildStaticSources());
    }

    public upsertCharge(charge: Charge): void {
        const index = this.charges.findIndex((c) => c.id === charge.id);
        if (index >= 0) {
            this.charges[index] = charge;
        } else {
            this.charges.push(charge);
        }
        void this.readyPromise.then(() => this.rebuildStaticSources());
    }

    public removeCharge(chargeId: string): void {
        this.charges = this.charges.filter((charge) => charge.id !== chargeId);
        void this.readyPromise.then(() => this.rebuildStaticSources());
    }

    public clearCharges(): void {
        this.charges = [];
        void this.readyPromise.then(() => this.rebuildStaticSources());
    }

    public setSimulationPaused(paused: boolean): void {
        this.paused = paused;
        if (this.paused) {
            this.accumulatorMs = 0;
        } else {
            this.lastTickTimeMs = performance.now();
        }
    }

    public setTargetStepsPerSecond(stepsPerSecond: number): void {
        const clamped = THREE.MathUtils.clamp(Math.round(stepsPerSecond), 1, 2000);
        this.targetStepsPerSecond = clamped;
        this.accumulatorMs = 0;
    }

    public sampleFieldAt(position: THREE.Vector3): ElectricFieldResult {
        const cacheKey = this.positionCacheKey(position);
        const cached = this.sampleCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const fallback = electricFieldAt(position, this.charges);
        this.sampleCache.set(cacheKey, fallback);
        void this.requestSample(position, cacheKey, fallback.potential);
        return fallback;
    }

    public samplePotentialAt(position: THREE.Vector3): number {
        // Potential is still analytical until volumetric scalar potential support is added.
        return electricFieldAt(position, this.charges).potential;
    }

    public getStats(): SimulationStats {
        const simulationDt = this.fdtdSimulation ? this.fdtdSimulation.getTimeStep() : 0;
        return {
            mode: this.mode,
            ready: this.fdtdSimulation !== null,
            usingFallback: this.fdtdSimulation === null,
            paused: this.paused,
            storageMode: this.storageMode,
            targetStepsPerSecond: this.targetStepsPerSecond,
            steps: this.totalSteps,
            stepsPerSecond: this.stepsPerSecond,
            dt: simulationDt,
            sampleCacheSize: this.sampleCache.size,
        };
    }

    public dispose(): void {
        this.disposed = true;
        this.stopTickLoop();
        this.sampleCache.clear();
        this.pendingSamples.clear();
        if (this.fdtdSimulation) {
            this.fdtdSimulation.destroy();
            this.fdtdSimulation = null;
        }
        this.charges = [];
    }

    private async rebuildStaticSources(): Promise<void> {
        const simulation = this.fdtdSimulation;
        if (!simulation) {
            return;
        }

        simulation.clearStaticSources();
        for (const charge of this.charges) {
            const coords = this.toSimulationCoordinates(charge.position);
            const scaledCharge = this.scaleChargeMagnitude(charge.magnitude);
            simulation.addPointCharge(coords.x, coords.y, scaledCharge);
        }
        this.sampleCache.clear();
    }

    private startTickLoop(): void {
        this.stopTickLoop();
        this.lastTickTimeMs = performance.now();
        this.lastRateUpdateMs = this.lastTickTimeMs;
        this.accumulatorMs = 0;
        this.stepsInWindow = 0;

        this.tickTimer = window.setInterval(() => {
            this.tickSimulation();
        }, 16);
    }

    private stopTickLoop(): void {
        if (this.tickTimer !== null) {
            window.clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    }

    private tickSimulation(): void {
        if (this.disposed || !this.fdtdSimulation) {
            return;
        }

        if (this.paused) {
            this.lastTickTimeMs = performance.now();
            return;
        }

        const now = performance.now();
        const elapsed = now - this.lastTickTimeMs;
        this.lastTickTimeMs = now;
        this.accumulatorMs += elapsed;

        const targetDeltaMs = 1000 / this.targetStepsPerSecond;
        let executed = 0;
        while (this.accumulatorMs >= targetDeltaMs && executed < this.targetStepsPerSecond) {
            this.fdtdSimulation.step();
            this.accumulatorMs -= targetDeltaMs;
            executed += 1;
        }

        if (executed > 0) {
            this.totalSteps += executed;
            this.stepsInWindow += executed;
        }

        const rateElapsed = now - this.lastRateUpdateMs;
        if (rateElapsed >= 1000) {
            this.stepsPerSecond = this.stepsInWindow / (rateElapsed / 1000);
            this.stepsInWindow = 0;
            this.lastRateUpdateMs = now;
        }
    }

    private async requestSample(
        position: THREE.Vector3,
        cacheKey: string,
        fallbackPotential: number,
    ): Promise<void> {
        if (this.pendingSamples.has(cacheKey)) {
            return;
        }

        this.pendingSamples.add(cacheKey);

        try {
            await this.readyPromise;
            const simulation = this.fdtdSimulation;
            if (!simulation || this.disposed) {
                return;
            }

            const normalized = this.toNormalizedCoordinates(position);
            const sample = await simulation.readFieldValueAt3D(
                normalized.x,
                normalized.y,
                normalized.z,
            );

            const result: ElectricFieldResult = {
                field: new THREE.Vector3(sample[0], sample[1], sample[2]),
                potential: fallbackPotential,
            };
            this.sampleCache.set(cacheKey, result);
        } catch {
            // Ignore transient sampling failures and keep analytical fallback cache.
        } finally {
            this.pendingSamples.delete(cacheKey);
        }
    }

    private toNormalizedCoordinates(position: THREE.Vector3): { x: number; y: number; z: number } {
        const size = this.bounds.max.clone().sub(this.bounds.min);
        const normalized = position.clone().sub(this.bounds.min);

        return {
            x: THREE.MathUtils.clamp(normalized.x / Math.max(size.x, 1e-6), 0, 1),
            y: THREE.MathUtils.clamp(normalized.y / Math.max(size.y, 1e-6), 0, 1),
            z: THREE.MathUtils.clamp(normalized.z / Math.max(size.z, 1e-6), 0, 1),
        };
    }

    private toSimulationCoordinates(position: THREE.Vector3): { x: number; y: number; z: number } {
        const n = this.toNormalizedCoordinates(position);
        return {
            x: n.x * 2 - 1,
            y: n.y * 2 - 1,
            z: n.z * 2 - 1,
        };
    }

    private scaleChargeMagnitude(magnitude: number): number {
        const scaled = magnitude * 1e6;
        return THREE.MathUtils.clamp(scaled, -10, 10);
    }

    private positionCacheKey(position: THREE.Vector3): string {
        const n = this.toNormalizedCoordinates(position);
        return `${n.x.toFixed(3)}:${n.y.toFixed(3)}:${n.z.toFixed(3)}`;
    }
}

export function createSimulationProvider(mode: SimulationMode, serverUrl?: string): SimulationProvider {
    if (mode === 'fdtd') {
        return new FDTDSimulationProvider();
    }
    if (mode === 'remote') {
        const url = serverUrl ?? 'ws://localhost:8765/ws';
        return new RemoteSimulationProvider(url);
    }
    return new AnalyticalSimulationProvider();
}

export { RemoteSimulationProvider };
