import * as THREE from 'three';
import type { Charge } from './Charge';

export type SourceWaveformType = 'dc' | 'sine' | 'pulse';

export interface SourceWaveform {
    type: SourceWaveformType;
    offset: number;
    amplitude: number;
    frequencyHz: number;
    phaseRad: number;
    dutyCycle: number;
}

export interface SimulationSource {
    id: string;
    name: string;
    position: THREE.Vector3;
    waveform: SourceWaveform;
}

export function createDefaultSource(id: string, position?: THREE.Vector3): SimulationSource {
    return {
        id,
        name: id,
        position: position ? position.clone() : new THREE.Vector3(0, 0, 0),
        waveform: {
            type: 'dc',
            offset: 1e-6,
            amplitude: 0,
            frequencyHz: 1,
            phaseRad: 0,
            dutyCycle: 0.5,
        },
    };
}

export function evaluateWaveform(wf: SourceWaveform, timeSeconds: number): number {
    if (wf.type === 'dc') {
        return wf.offset;
    }

    if (wf.type === 'sine') {
        return wf.offset + wf.amplitude * Math.sin(2 * Math.PI * wf.frequencyHz * timeSeconds + wf.phaseRad);
    }

    const duty = Math.min(Math.max(wf.dutyCycle, 0.01), 0.99);
    const period = 1 / Math.max(wf.frequencyHz, 1e-6);
    const localTime = ((timeSeconds + wf.phaseRad / (2 * Math.PI * Math.max(wf.frequencyHz, 1e-6))) % period + period) % period;
    const isHigh = localTime < period * duty;
    return wf.offset + (isHigh ? wf.amplitude : -wf.amplitude);
}

export function evaluateSourceMagnitude(source: SimulationSource, timeSeconds: number): number {
    return evaluateWaveform(source.waveform, timeSeconds);
}

export function evaluateSourceCharge(source: SimulationSource, timeSeconds: number): Charge {
    return {
        id: source.id,
        position: source.position.clone(),
        magnitude: evaluateSourceMagnitude(source, timeSeconds),
    };
}

export function evaluateSourcesToCharges(sources: SimulationSource[], timeSeconds: number): Charge[] {
    return sources.map((source) => evaluateSourceCharge(source, timeSeconds));
}
