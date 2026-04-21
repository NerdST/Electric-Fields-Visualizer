import React from 'react';
import type { SimObject } from '../models/simobject';
import { getInspector } from './inspectors/registry';
import './inspectors/registerInspectors';

export interface InspectorPanelProps {
  selectedObject: SimObject | null;
  timeSeconds: number;
  update: (patch: Partial<SimObject>) => void;
  onDelete: () => void;
}

const baseStyle: React.CSSProperties = {
  position: 'absolute',
  top: '10px',
  right: '10px',
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

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedObject,
  timeSeconds,
  update,
  onDelete,
}) => {
  if (!selectedObject) {
    return (
      <div style={{ ...baseStyle, color: '#888' }}>
        Select an object to inspect.
      </div>
    );
  }

  const Inspector = getInspector(selectedObject.kind);
  if (!Inspector) {
    return (
      <div style={baseStyle}>
        No inspector registered for kind "{selectedObject.kind}".
      </div>
    );
  }

  return (
    <div style={baseStyle}>
      <Inspector
        object={selectedObject}
        timeSeconds={timeSeconds}
        update={update}
        onDelete={onDelete}
      />
    </div>
  );
};
