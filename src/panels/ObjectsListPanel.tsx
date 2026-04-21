import React from 'react';
import { getDescriptor, type SimObject } from '../models/simobject';

export interface ObjectsListPanelProps {
  objects: SimObject[];
  selectedObjectId: string | null;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onDelete: (id: string) => void;
  onAddPointCharge: () => void;
  onRemoveLastAdded: () => void;
  onRemoveAllCharges: () => void;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '10px',
  left: '10px',
  background: 'rgba(0, 0, 0, 0.8)',
  color: 'white',
  padding: '12px',
  borderRadius: '8px',
  fontFamily: 'monospace',
  fontSize: '12px',
  minWidth: '260px',
  maxHeight: '40vh',
  overflowY: 'auto',
};

const btnBase: React.CSSProperties = {
  padding: '6px 10px',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '11px',
};

export const ObjectsListPanel: React.FC<ObjectsListPanelProps> = (p) => {
  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
        Scene Objects ({p.objects.length})
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button onClick={p.onAddPointCharge} style={{ ...btnBase, background: '#4CAF50' }}>
          + Point Charge
        </button>
        <button onClick={p.onRemoveLastAdded} style={{ ...btnBase, background: '#f57c00' }}>
          Undo Add
        </button>
        <button onClick={p.onRemoveAllCharges} style={{ ...btnBase, background: '#ff6b6b' }}>
          Clear Charges
        </button>
      </div>

      {p.objects.length === 0 ? (
        <div style={{ fontSize: '10px', color: '#888' }}>No objects in scene.</div>
      ) : (
        p.objects.map((obj) => {
          const d = getDescriptor(obj.kind);
          const selected = p.selectedObjectId === obj.id;
          return (
            <div
              key={obj.id}
              onClick={() => p.onSelect(obj.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px',
                marginBottom: '4px',
                borderRadius: '4px',
                background: selected ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.05)',
                border: selected ? '1px solid #ffd700' : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '14px' }}>{d?.icon ?? '•'}</span>
              <span style={{ flex: 1 }}>{obj.name}</span>
              <input
                type="checkbox"
                checked={obj.visible}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => p.onToggleVisible(obj.id, e.target.checked)}
                title={obj.visible ? 'Visible' : 'Hidden'}
              />
              <button
                onClick={(e) => { e.stopPropagation(); p.onDelete(obj.id); }}
                style={{ ...btnBase, background: '#f44336', padding: '2px 6px' }}
              >
                ✕
              </button>
            </div>
          );
        })
      )}
    </div>
  );
};
