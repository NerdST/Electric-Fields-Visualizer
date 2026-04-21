import React, { useEffect, useRef, useState } from 'react';
import { evaluateWaveform, type SourceWaveformType } from '../../models/SimulationSource';
import type { PointChargeObject } from '../../models/simobject';
import type { InspectorProps } from './registry';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px',
  borderRadius: '3px',
  border: '1px solid #555',
  background: 'rgba(255, 255, 255, 0.1)',
  color: 'white',
  fontSize: '11px',
};

export const PointChargeInspector: React.FC<InspectorProps<PointChargeObject>> = ({
  object,
  timeSeconds,
  update,
  onDelete,
}) => {
  const evaluated = evaluateWaveform(object.waveform, timeSeconds);

  // Position inputs are locally buffered so the user can type intermediate states
  // like "-", "1.", or "" without the component rejecting every keystroke.
  const [posInputs, setPosInputs] = useState({
    x: object.position.x.toString(),
    y: object.position.y.toString(),
    z: object.position.z.toString(),
  });
  const isEditingRef = useRef(false);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isEditingRef.current && object.id !== prevIdRef.current) {
      prevIdRef.current = object.id;
      setPosInputs({
        x: object.position.x.toString(),
        y: object.position.y.toString(),
        z: object.position.z.toString(),
      });
    }
  }, [object.id, object.position]);

  const setWaveformField = (
    field: 'type' | 'offset' | 'amplitude' | 'frequencyHz' | 'phaseRad' | 'dutyCycle',
    value: number | SourceWaveformType,
  ) => {
    update({ waveform: { ...object.waveform, [field]: value } });
  };

  const setAxis = (axis: 'x' | 'y' | 'z', raw: string) => {
    if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;
    setPosInputs((prev) => ({ ...prev, [axis]: raw }));
    const num = parseFloat(raw);
    if (!Number.isNaN(num)) {
      const next = object.position.clone();
      next[axis] = num;
      update({ position: next });
    }
  };

  return (
    <div>
      <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
        Point Charge: {object.name}
      </div>

      <Field label="Source Type">
        <select
          value={object.waveform.type}
          onChange={(e) => setWaveformField('type', e.target.value as SourceWaveformType)}
          style={inputStyle}
        >
          <option value="dc" style={{ color: '#111' }}>DC</option>
          <option value="sine" style={{ color: '#111' }}>Sine</option>
          <option value="pulse" style={{ color: '#111' }}>Pulse</option>
        </select>
      </Field>

      <Field label="Magnitude (μC)">
        <input
          type="number"
          value={(evaluated * 1e6).toFixed(2)}
          onChange={(e) => {
            const next = parseFloat(e.target.value) * 1e-6;
            if (!Number.isNaN(next)) setWaveformField('offset', next);
          }}
          style={inputStyle}
        />
      </Field>

      {object.waveform.type !== 'dc' && (
        <>
          <Field label="Amplitude (μC)">
            <input
              type="number"
              value={(object.waveform.amplitude * 1e6).toFixed(2)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setWaveformField('amplitude', v * 1e-6);
              }}
              style={inputStyle}
            />
          </Field>

          <Field label="Frequency (Hz)">
            <input
              type="number"
              value={object.waveform.frequencyHz}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setWaveformField('frequencyHz', Math.max(0.001, v));
              }}
              style={inputStyle}
            />
          </Field>
        </>
      )}

      {object.waveform.type === 'pulse' && (
        <Field label="Duty Cycle">
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={object.waveform.dutyCycle}
            onChange={(e) => setWaveformField('dutyCycle', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </Field>
      )}

      {(['x', 'y', 'z'] as const).map((axis) => (
        <Field key={axis} label={`Position ${axis.toUpperCase()}`}>
          <input
            type="text"
            value={posInputs[axis]}
            onFocus={() => { isEditingRef.current = true; }}
            onBlur={() => { isEditingRef.current = false; }}
            onChange={(e) => setAxis(axis, e.target.value)}
            style={inputStyle}
          />
        </Field>
      ))}

      {onDelete && (
        <button
          onClick={onDelete}
          style={{
            marginTop: '10px',
            padding: '6px 10px',
            width: '100%',
            background: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '5px' }}>
      <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>{label}</label>
      {children}
    </div>
  );
}
