import React from 'react';
import type { VoltagePoint } from '../models/VoltagePoint';

export interface LegacyVoltagePointPanelProps {
  points: VoltagePoint[];
  showAddUI: boolean;
  setShowAddUI: (v: boolean) => void;
  newCoords: { x: number; y: number; z: number };
  setNewCoords: (c: { x: number; y: number; z: number }) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
}

export const LegacyVoltagePointPanel: React.FC<LegacyVoltagePointPanelProps> = (p) => {
  return (
    <>
      {p.showAddUI && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '290px',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '20px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            zIndex: 1000,
            minWidth: '280px',
            border: '2px solid #444',
          }}
        >
          <div style={{ marginBottom: '12px', fontWeight: 'bold', fontSize: '14px' }}>
            Add Voltage Measurement Point
          </div>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', marginBottom: '4px' }}>{axis.toUpperCase()}:</label>
              <input
                type="number"
                value={p.newCoords[axis]}
                onChange={(e) =>
                  p.setNewCoords({ ...p.newCoords, [axis]: parseFloat(e.target.value) || 0 })
                }
                style={{
                  width: '100%',
                  padding: '5px',
                  background: '#333',
                  color: 'white',
                  border: '1px solid #555',
                  borderRadius: '3px',
                  fontSize: '12px',
                }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={p.onAdd}
              style={{
                flex: 1, padding: '8px', background: '#4CAF50', color: 'white',
                border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px',
              }}
            >
              Measure Voltage
            </button>
            <button
              onClick={() => p.setShowAddUI(false)}
              style={{
                flex: 1, padding: '8px', background: '#f44336', color: 'white',
                border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {p.points.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '15px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            minWidth: '260px',
            maxHeight: '40vh',
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
            Voltage Points ({p.points.length})
          </div>

          {p.points.map((point, index) => (
            <div
              key={point.id}
              style={{
                border: '1px solid #555',
                padding: '8px',
                marginBottom: '5px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                Point {index + 1}
              </div>
              <div style={{ fontSize: '10px', marginBottom: '2px' }}>
                Position: ({point.position.x.toFixed(2)}, {point.position.y.toFixed(2)},{' '}
                {point.position.z.toFixed(2)})
              </div>
              <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                Voltage: {point.voltage.toExponential(2)} V
              </div>
              <button
                onClick={() => p.onRemove(point.id)}
                style={{
                  padding: '4px 8px', background: '#f44336', color: 'white',
                  border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
                }}
              >
                Remove
              </button>
            </div>
          ))}

          <button
            onClick={p.onRemoveAll}
            style={{
              padding: '8px 12px', background: '#ff6b6b', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
              fontSize: '11px', width: '100%', marginTop: '10px',
            }}
          >
            🗑 Remove All
          </button>
        </div>
      )}
    </>
  );
};
