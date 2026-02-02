import React from 'react';

interface VoltagePointDialogProps {
  newVoltagePoint: { x: number; y: number; z: number };
  onNewVoltagePointChange: (field: 'x' | 'y' | 'z', value: number) => void;
  onAddVoltagePoint: () => void;
  onCancel: () => void;
}

const VoltagePointDialog: React.FC<VoltagePointDialogProps> = ({
  newVoltagePoint,
  onNewVoltagePointChange,
  onAddVoltagePoint,
  onCancel,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
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
      <div
        style={{
          marginBottom: '12px',
          fontWeight: 'bold',
          fontSize: '14px',
        }}
      >
        Add Voltage Measurement Point
      </div>
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>X:</label>
        <input
          type="number"
          value={newVoltagePoint.x}
          onChange={(e) =>
            onNewVoltagePointChange('x', parseFloat(e.target.value) || 0)
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
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Y:</label>
        <input
          type="number"
          value={newVoltagePoint.y}
          onChange={(e) =>
            onNewVoltagePointChange('y', parseFloat(e.target.value) || 0)
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
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Z:</label>
        <input
          type="number"
          value={newVoltagePoint.z}
          onChange={(e) =>
            onNewVoltagePointChange('z', parseFloat(e.target.value) || 0)
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
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={onAddVoltagePoint}
          style={{
            flex: 1,
            padding: '8px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Measure Voltage
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '8px',
            background: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default VoltagePointDialog;

