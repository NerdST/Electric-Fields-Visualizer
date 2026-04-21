import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Charge } from '../models/Charge';
import {
  createSimulationProvider,
  type SimulationMode,
  type SimulationProvider,
  type SimulationStats,
} from '../models/simulation/SimulationProvider';

const INITIAL_STATS: SimulationStats = {
  mode: 'analytical',
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

export interface SimulationProviderState {
  mode: SimulationMode;
  setMode: (m: SimulationMode) => void;
  remoteServerUrl: string;
  setRemoteServerUrl: (url: string) => void;
  stats: SimulationStats;
  fdtdPaused: boolean;
  setFdtdPaused: React.Dispatch<React.SetStateAction<boolean>>;
  fdtdTargetSps: number;
  setFdtdTargetSps: React.Dispatch<React.SetStateAction<number>>;
  /** Push the evaluated charge list into the provider (kept reactive via chargesRef). */
  setCharges: (charges: Charge[]) => void;
  sampleFieldAt: (p: THREE.Vector3) => { field: THREE.Vector3; potential: number };
  samplePotentialAt: (p: THREE.Vector3) => number;
  invalidateFieldCache: () => void;
}

/**
 * Owns the SimulationProvider instance. Re-creates it when mode or remote URL changes,
 * propagating paused/target-sps state and re-seeding charges from the supplied ref.
 */
export function useSimulationProvider(chargesRef: React.MutableRefObject<Charge[]>): SimulationProviderState {
  const [mode, setMode] = useState<SimulationMode>('analytical');
  const [remoteServerUrl, setRemoteServerUrl] = useState('ws://localhost:8765/ws');
  const [stats, setStats] = useState<SimulationStats>(INITIAL_STATS);
  const [fdtdPaused, setFdtdPaused] = useState(true);
  const [fdtdTargetSps, setFdtdTargetSps] = useState(240);
  const providerRef = useRef<SimulationProvider>(createSimulationProvider('analytical'));

  useEffect(() => {
    providerRef.current.dispose();
    providerRef.current = createSimulationProvider(mode, remoteServerUrl);
    providerRef.current.setCharges(chargesRef.current);
    providerRef.current.setSimulationPaused(fdtdPaused);
    providerRef.current.setTargetStepsPerSecond(fdtdTargetSps);
    setStats(providerRef.current.getStats());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, remoteServerUrl]);

  useEffect(() => {
    providerRef.current.setSimulationPaused(fdtdPaused);
  }, [fdtdPaused, mode]);

  useEffect(() => {
    providerRef.current.setTargetStepsPerSecond(fdtdTargetSps);
  }, [fdtdTargetSps, mode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStats(providerRef.current.getStats());
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => providerRef.current.dispose(), []);

  const setCharges = useCallback((charges: Charge[]) => {
    providerRef.current.setCharges(charges);
  }, []);

  const sampleFieldAt = useCallback((p: THREE.Vector3) => {
    return providerRef.current.sampleFieldAt(p);
  }, []);

  const samplePotentialAt = useCallback((p: THREE.Vector3) => {
    return providerRef.current.samplePotentialAt(p);
  }, []);

  const invalidateFieldCache = useCallback(() => {
    providerRef.current.invalidateFieldCache();
  }, []);

  return {
    mode, setMode,
    remoteServerUrl, setRemoteServerUrl,
    stats,
    fdtdPaused, setFdtdPaused,
    fdtdTargetSps, setFdtdTargetSps,
    setCharges,
    sampleFieldAt, samplePotentialAt, invalidateFieldCache,
  };
}
