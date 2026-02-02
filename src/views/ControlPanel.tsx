import React from 'react';
import * as THREE from 'three';
import type { Charge } from '../models/Charge';

interface ControlPanelProps {
  chargesCount: number;
  hoverVoltage: number | null;
  hoverPosition: THREE.Vector3 | null;
  showVectorField: boolean;
  selectedCharge: Charge | null;
  positionInputs: { x: string; y: string; z: string };
  chargeStackLength: number;
  onAddCharge: () => void;
  onRemoveLastAdded: () => void;
  onRemoveAllCharges: () => void;
  onToggleVectorField: () => void;
  onAddVoltagePointClick: () => void;
  onUpdateChargeMagnitude: (chargeId: string, magnitude: number) => void;
  onUpdateChargePosition: (chargeId: string, position: THREE.Vector3) => void;
  onPositionInputChange: (field: 'x' | 'y' | 'z', value: string) => void;
  onPositionInputFocus: () => void;
  onPositionInputBlur: () => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  chargesCount,
  hoverVoltage,
  hoverPosition,
  showVectorField,
  selectedCharge,
  positionInputs,
  chargeStackLength,
  onAddCharge,
  onRemoveLastAdded,
  onRemoveAllCharges,
  onToggleVectorField,
  onAddVoltagePointClick,
  onUpdateChargeMagnitude,
  onUpdateChargePosition,
  onPositionInputChange,
  onPositionInputFocus,
  onPositionInputBlur,
}) => {
  return (
    <div
      style={{
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
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
        Electric Field Visualizer
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div>Charges: {chargesCount}</div>
        <div style={{ fontSize: '10px', color: '#ccc' }}>
          Click charges to select, click empty space to add a voltage point
        </div>
      </div>

      {hoverVoltage !== null && hoverPosition && (
        <div
          style={{
            marginBottom: '10px',
            padding: '6px',
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: '4px',
            fontSize: '11px',
          }}
        >
          <div>Voltage at cursor: {hoverVoltage.toExponential(2)} V</div>
          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>
            ({hoverPosition.x.toFixed(2)}, {hoverPosition.y.toFixed(2)},{' '}
            {hoverPosition.z.toFixed(2)})
          </div>
        </div>
      )}

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={onAddCharge}
          style={{
            padding: '8px 12px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginRight: '5px',
            fontSize: '11px',
          }}
        >
          + Add Charge
        </button>

        {chargeStackLength > 0 && (
          <button
            onClick={onRemoveLastAdded}
            style={{
              padding: '8px 12px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginRight: '5px',
              fontSize: '11px',
            }}
          >
            - Remove Last
          </button>
        )}

        {chargesCount > 0 && (
          <button
            onClick={onRemoveAllCharges}
            style={{
              padding: '8px 12px',
              background: '#ff6b6b',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            🗑 Remove All
          </button>
        )}
      </div>

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={onToggleVectorField}
          style={{
            padding: '8px 12px',
            background: showVectorField ? '#4CAF50' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            width: '100%',
          }}
        >
          {showVectorField ? 'Hide' : 'Show'} Vector Field
        </button>
      </div>

      <button
        onClick={onAddVoltagePointClick}
        style={{
          padding: '8px 12px',
          background: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '10px',
          fontSize: '11px',
          width: '100%',
        }}
      >
        Add Voltage Measurement (by coordinates)
      </button>

      {selectedCharge && (
        <div
          style={{
            border: '1px solid #555',
            padding: '10px',
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
            Selected Charge: {selectedCharge.id}
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>
              Magnitude (μC):
            </label>
            <input
              type="number"
              value={(selectedCharge.magnitude * 1e6).toFixed(2)}
              onChange={(e) => {
                const newMagnitude = parseFloat(e.target.value) * 1e-6;
                onUpdateChargeMagnitude(selectedCharge.id, newMagnitude);
              }}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px',
              }}
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>Position X:</label>
            <input
              type="text"
              value={positionInputs.x}
              onFocus={onPositionInputFocus}
              onBlur={onPositionInputBlur}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                  onPositionInputChange('x', val);
                  const numVal = parseFloat(val);
                  if (!isNaN(numVal)) {
                    const newPos = selectedCharge.position.clone();
                    newPos.x = numVal;
                    onUpdateChargePosition(selectedCharge.id, newPos);
                  }
                }
              }}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px',
              }}
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>Position Y:</label>
            <input
              type="text"
              value={positionInputs.y}
              onFocus={onPositionInputFocus}
              onBlur={onPositionInputBlur}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                  onPositionInputChange('y', val);
                  const numVal = parseFloat(val);
                  if (!isNaN(numVal)) {
                    const newPos = selectedCharge.position.clone();
                    newPos.y = numVal;
                    onUpdateChargePosition(selectedCharge.id, newPos);
                  }
                }
              }}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '2px' }}>Position Z:</label>
            <input
              type="text"
              value={positionInputs.z}
              onFocus={onPositionInputFocus}
              onBlur={onPositionInputBlur}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                  onPositionInputChange('z', val);
                  const numVal = parseFloat(val);
                  if (!isNaN(numVal)) {
                    const newPos = selectedCharge.position.clone();
                    newPos.z = numVal;
                    onUpdateChargePosition(selectedCharge.id, newPos);
                  }
                }
              }}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;

