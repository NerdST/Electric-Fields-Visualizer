import React from 'react';
import * as THREE from 'three';
import type { SimulationMode, SimulationStats } from '../models/simulation/SimulationProvider';

export interface GlobalsPanelProps {
  mode: SimulationMode;
  setMode: (m: SimulationMode) => void;
  remoteServerUrl: string;
  setRemoteServerUrl: (u: string) => void;
  stats: SimulationStats;

  timeSeconds: number;
  running: boolean;
  setRunning: (v: boolean | ((prev: boolean) => boolean)) => void;
  stepOnce: () => void;
  timeScale: number;
  setTimeScale: (v: number) => void;

  fdtdPaused: boolean;
  setFdtdPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  fdtdTargetSps: number;
  setFdtdTargetSps: (v: number) => void;

  evaluatedChargeCount: number;
  pointChargeCount: number;
  hoverVoltage: number | null;
  hoverPosition: THREE.Vector3 | null;

  showVectorField: boolean;
  toggleVectorField: () => void;
  showFieldLines: boolean;
  toggleFieldLines: () => void;

  onAddVoltageMeasurement: () => void;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '10px',
  left: '10px',
  background: 'rgba(0, 0, 0, 0.8)',
  color: 'white',
  padding: '15px',
  borderRadius: '8px',
  fontFamily: 'monospace',
  fontSize: '12px',
  minWidth: '260px',
  maxHeight: 'calc(100vh - 20px)',
  overflowY: 'auto',
};

export const GlobalsPanel: React.FC<GlobalsPanelProps> = (p) => {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
        Electric Field Visualizer
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Simulation Mode:</label>
        <select
          value={p.mode}
          onChange={(e) => p.setMode(e.target.value as SimulationMode)}
          style={{
            width: '100%',
            padding: '6px',
            borderRadius: '3px',
            border: '1px solid #555',
            background: 'rgba(255, 255, 255, 0.1)',
            color: 'white',
            fontSize: '11px',
          }}
        >
          <option value="analytical" style={{ color: '#111' }}>Analytical</option>
          <option value="fdtd" style={{ color: '#111' }}>FDTD (WIP)</option>
          <option value="remote" style={{ color: '#111' }}>Remote FDTD</option>
        </select>
      </div>

      {p.mode === 'remote' && (
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Remote Server URL:</label>
          <input
            type="text"
            value={p.remoteServerUrl}
            onChange={(e) => p.setRemoteServerUrl(e.target.value)}
            placeholder="ws://localhost:8765/ws"
            style={{
              width: '100%',
              padding: '6px',
              borderRadius: '3px',
              border: `1px solid ${p.stats.ready ? '#4c4' : '#c44'}`,
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              fontSize: '10px',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: '10px', marginTop: '3px', color: p.stats.ready ? '#4c4' : '#f88' }}>
            {p.stats.ready ? 'Connected' : 'Disconnected — check server URL'}
          </div>
        </div>
      )}

      <div
        style={{
          marginBottom: '10px',
          padding: '6px',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.08)',
          fontSize: '10px',
        }}
      >
        <div>Status: {p.stats.ready ? 'ready' : 'initializing'}</div>
        <div>Fallback: {p.stats.usingFallback ? 'yes' : 'no'}</div>
        <div>Paused: {p.stats.paused ? 'yes' : 'no'}</div>
        <div>Storage: {p.stats.storageMode}</div>
        <div>Target SPS: {p.stats.targetStepsPerSecond}</div>
        <div>Steps: {p.stats.steps}</div>
        <div>Steps/sec: {p.stats.stepsPerSecond.toFixed(1)}</div>
        <div>dt: {p.stats.dt.toExponential(3)} s</div>
        <div>Cache: {p.stats.sampleCacheSize}</div>
      </div>

      <div
        style={{
          marginBottom: '10px',
          padding: '8px',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ fontSize: '11px', marginBottom: '6px' }}>Simulation Clock</div>
        <div style={{ fontSize: '10px', marginBottom: '6px' }}>
          t = {p.timeSeconds.toFixed(4)} s
        </div>
        <button
          onClick={() => p.setRunning((prev) => !prev)}
          style={{
            width: '100%',
            padding: '6px',
            marginBottom: '6px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'white',
            background: p.running ? '#f57c00' : '#4CAF50',
            fontSize: '11px',
          }}
        >
          {p.running ? 'Pause Time' : 'Run Time'}
        </button>
        <button
          onClick={p.stepOnce}
          style={{
            width: '100%',
            padding: '6px',
            marginBottom: '6px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'white',
            background: '#546E7A',
            fontSize: '11px',
          }}
        >
          Step +dt
        </button>
        <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px' }}>
          Time Scale: {p.timeScale.toFixed(2)}x
        </label>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.1}
          value={p.timeScale}
          onChange={(e) => p.setTimeScale(parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {p.mode === 'fdtd' && (
        <div
          style={{
            marginBottom: '10px',
            padding: '8px',
            borderRadius: '4px',
            background: 'rgba(33,150,243,0.12)',
            border: '1px solid rgba(33,150,243,0.35)',
          }}
        >
          <button
            onClick={() => p.setFdtdPaused((prev) => !prev)}
            style={{
              width: '100%',
              padding: '6px',
              marginBottom: '8px',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'white',
              background: p.fdtdPaused ? '#4CAF50' : '#f57c00',
              fontSize: '11px',
            }}
          >
            {p.fdtdPaused ? 'Resume Simulation' : 'Pause Simulation'}
          </button>

          <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px' }}>
            Target Steps/sec: {p.fdtdTargetSps}
          </label>
          <input
            type="range"
            min={30}
            max={1000}
            step={10}
            value={p.fdtdTargetSps}
            onChange={(e) => p.setFdtdTargetSps(parseInt(e.target.value, 10))}
            style={{ width: '100%' }}
          />
        </div>
      )}

      <div style={{ marginBottom: '8px' }}>
        <div>Charges: {p.evaluatedChargeCount}</div>
        <div>Sources: {p.pointChargeCount}</div>
        <div style={{ fontSize: '10px', color: '#ccc' }}>
          Click objects to select, click empty space for voltage probe.
        </div>
      </div>

      {p.hoverVoltage !== null && p.hoverPosition && (
        <div
          style={{
            marginBottom: '10px',
            padding: '6px',
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: '4px',
            fontSize: '11px',
          }}
        >
          <div>Voltage at cursor: {p.hoverVoltage.toExponential(2)} V</div>
          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>
            ({p.hoverPosition.x.toFixed(2)}, {p.hoverPosition.y.toFixed(2)},{' '}
            {p.hoverPosition.z.toFixed(2)})
          </div>
        </div>
      )}

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={p.toggleVectorField}
          style={{
            padding: '8px 12px',
            background: p.showVectorField ? '#4CAF50' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            width: '100%',
            marginBottom: '5px',
          }}
        >
          {p.showVectorField ? 'Hide' : 'Show'} Vector Field
        </button>
        <button
          onClick={p.toggleFieldLines}
          style={{
            padding: '8px 12px',
            background: p.showFieldLines ? '#4CAF50' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            width: '100%',
          }}
        >
          {p.showFieldLines ? 'Hide' : 'Show'} Field Lines
        </button>
      </div>

      <button
        onClick={p.onAddVoltageMeasurement}
        style={{
          padding: '8px 12px',
          background: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '11px',
          width: '100%',
        }}
      >
        Add Voltage Measurement (by coordinates)
      </button>
    </div>
  );
};
