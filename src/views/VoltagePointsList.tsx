import React from 'react';
import type { VoltagePoint } from '../models/VoltagePoint';

interface VoltagePointsListProps {
  voltagePoints: VoltagePoint[];
  onRemoveVoltagePoint: (pointId: string) => void;
  onRemoveAllVoltagePoints: () => void;
}

const VoltagePointsList: React.FC<VoltagePointsListProps> = ({
  voltagePoints,
  onRemoveVoltagePoint,
  onRemoveAllVoltagePoints,
}) => {
  if (voltagePoints.length === 0) {
    return null;
  }

  return (
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
        minWidth: '300px',
        maxHeight: '300px',
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
        Voltage Points ({voltagePoints.length})
      </div>

      {voltagePoints.map((point, index) => (
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
            onClick={() => onRemoveVoltagePoint(point.id)}
            style={{
              padding: '4px 8px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            Remove
          </button>
        </div>
      ))}

      {voltagePoints.length > 0 && (
        <button
          onClick={onRemoveAllVoltagePoints}
          style={{
            padding: '8px 12px',
            background: '#ff6b6b',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            width: '100%',
            marginTop: '10px',
          }}
        >
          🗑 Remove All
        </button>
      )}
    </div>
  );
};

export default VoltagePointsList;

