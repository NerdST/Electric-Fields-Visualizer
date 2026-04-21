import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Charge } from '../models/Charge';
import { electricFieldAt } from '../models/Charge';
import { VectorFieldRenderer, createDefaultVectorFieldConfig } from '../views/VectorField';
import { FieldLineRenderer, createDefaultFieldLineConfig } from '../views/FieldLines';
import { workspaceScene } from '../scene/WorkspaceScene';
import { useSimulationProvider } from '../hooks/useSimulationProvider';
import { useSimulationClock } from '../hooks/useSimulationClock';
import { useSimObjects } from '../hooks/useSimObjects';
import { useSelection } from '../hooks/useSelection';
import { useLegacyVoltagePoints } from '../hooks/useLegacyVoltagePoints';
import { GlobalsPanel } from '../panels/GlobalsPanel';
import { ObjectsListPanel } from '../panels/ObjectsListPanel';
import { InspectorPanel } from '../panels/InspectorPanel';
import { LegacyVoltagePointPanel } from '../panels/LegacyVoltagePointPanel';
import type { SimObject } from '../models/simobject';

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    return workspaceScene.attach(containerRef.current);
  }, []);

  const clock = useSimulationClock();

  const chargesRef = useRef<Charge[]>([]);
  const vectorFieldRendererRef = useRef<VectorFieldRenderer | null>(null);
  const fieldLineRendererRef = useRef<FieldLineRenderer | null>(null);

  const provider = useSimulationProvider(chargesRef);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [showVectorField, setShowVectorField] = useState(true);
  const [showFieldLines, setShowFieldLines] = useState(false);

  const onEvaluatedChargesChanged = useCallback((charges: Charge[]) => {
    chargesRef.current = charges;
    provider.setCharges(charges);
    vectorFieldRendererRef.current?.updateCharges(charges);
  }, [provider]);

  const sim = useSimObjects({
    scene: workspaceScene.scene,
    timeSeconds: clock.timeSeconds,
    selectedObjectId,
    onEvaluatedChargesChanged,
  });

  // Re-seed view renderers when the simulation mode changes (provider was rebuilt).
  useEffect(() => {
    vectorFieldRendererRef.current?.updateCharges(chargesRef.current);
    fieldLineRendererRef.current?.updateCharges(chargesRef.current);
  }, [provider.mode, provider.remoteServerUrl]);

  // Vector field renderer — owned by this effect so StrictMode double-invoke is safe.
  useEffect(() => {
    const cfg = createDefaultVectorFieldConfig();
    cfg.fieldSampler = (p) => provider.sampleFieldAt(p);
    const vf = new VectorFieldRenderer(workspaceScene.scene, cfg);
    vf.updateCharges(chargesRef.current);
    vf.setVisible(showVectorField);
    vectorFieldRendererRef.current = vf;
    return () => {
      vf.dispose();
      vectorFieldRendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Field lines — same pattern, with 1 Hz refresh tied to the live instance.
  useEffect(() => {
    const cfg = createDefaultFieldLineConfig();
    cfg.fieldSampler = (p, c) => electricFieldAt(p, c);
    const fl = new FieldLineRenderer(workspaceScene.scene, cfg);
    fl.updateCharges(chargesRef.current);
    fl.setVisible(showFieldLines);
    fieldLineRendererRef.current = fl;
    const id = window.setInterval(() => {
      fl.updateCharges(chargesRef.current);
    }, 1000);
    return () => {
      window.clearInterval(id);
      fl.dispose();
      fieldLineRendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic field-cache invalidation — forces the vector field to re-sample from the
  // live SimulationProvider so FDTD updates propagate into the arrows.
  useEffect(() => {
    const id = window.setInterval(() => {
      provider.invalidateFieldCache();
      vectorFieldRendererRef.current?.updateCharges(chargesRef.current);
    }, 300);
    return () => window.clearInterval(id);
  }, [provider]);

  const legacyVP = useLegacyVoltagePoints({
    scene: workspaceScene.scene,
    chargesVersion: sim.chargesState,
    sampleFieldAt: provider.sampleFieldAt,
    samplePotentialAt: provider.samplePotentialAt,
  });

  const { hoverPosition, hoverVoltage } = useSelection({
    domElement: workspaceScene.domElement,
    camera: workspaceScene.camera,
    hasControls: () => workspaceScene.hasControls,
    renderersRef: sim.renderersRef,
    setSelectedObjectId,
    samplePotentialAt: provider.samplePotentialAt,
    extraSelectableMeshes: legacyVP.getSelectableMeshes,
    onEmptyClick: () => legacyVP.setShowAddUI(true),
  });

  const selectedObject = useMemo<SimObject | null>(
    () => (selectedObjectId ? sim.objects.find((o) => o.id === selectedObjectId) ?? null : null),
    [sim.objects, selectedObjectId],
  );

  const toggleVectorField = () => {
    const v = !showVectorField;
    setShowVectorField(v);
    vectorFieldRendererRef.current?.setVisible(v);
  };
  const toggleFieldLines = () => {
    const v = !showFieldLines;
    setShowFieldLines(v);
    fieldLineRendererRef.current?.setVisible(v);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#282c34' }} />

      <GlobalsPanel
        mode={provider.mode}
        setMode={provider.setMode}
        remoteServerUrl={provider.remoteServerUrl}
        setRemoteServerUrl={provider.setRemoteServerUrl}
        stats={provider.stats}
        timeSeconds={clock.timeSeconds}
        running={clock.running}
        setRunning={clock.setRunning}
        stepOnce={clock.stepOnce}
        timeScale={clock.timeScale}
        setTimeScale={clock.setTimeScale}
        fdtdPaused={provider.fdtdPaused}
        setFdtdPaused={provider.setFdtdPaused}
        fdtdTargetSps={provider.fdtdTargetSps}
        setFdtdTargetSps={provider.setFdtdTargetSps}
        evaluatedChargeCount={sim.chargesState.length}
        pointChargeCount={sim.pointCharges.length}
        hoverVoltage={hoverVoltage}
        hoverPosition={hoverPosition}
        showVectorField={showVectorField}
        toggleVectorField={toggleVectorField}
        showFieldLines={showFieldLines}
        toggleFieldLines={toggleFieldLines}
        onAddVoltageMeasurement={() => {
          legacyVP.setNewCoords({ x: 0, y: 0, z: 0 });
          legacyVP.setShowAddUI(true);
        }}
      />

      <ObjectsListPanel
        objects={sim.objects}
        selectedObjectId={selectedObjectId}
        onSelect={setSelectedObjectId}
        onToggleVisible={sim.setObjectVisible}
        onDelete={(id) => {
          sim.removeObject(id);
          if (selectedObjectId === id) setSelectedObjectId(null);
        }}
        onAddPointCharge={sim.addPointCharge}
        onRemoveLastAdded={() => {
          sim.removeLastAdded();
          // If the undone charge was selected, clear selection.
          if (selectedObjectId && !sim.objects.some((o) => o.id === selectedObjectId)) {
            setSelectedObjectId(null);
          }
        }}
        onRemoveAllCharges={() => {
          sim.removeAllCharges();
          setSelectedObjectId(null);
        }}
      />

      <InspectorPanel
        selectedObject={selectedObject}
        timeSeconds={clock.timeSeconds}
        update={(patch) => {
          if (selectedObject) sim.updateObject(selectedObject.id, patch);
        }}
        onDelete={() => {
          if (selectedObject) {
            sim.removeObject(selectedObject.id);
            setSelectedObjectId(null);
          }
        }}
      />

      <LegacyVoltagePointPanel
        points={legacyVP.points}
        showAddUI={legacyVP.showAddUI}
        setShowAddUI={legacyVP.setShowAddUI}
        newCoords={legacyVP.newCoords}
        setNewCoords={legacyVP.setNewCoords}
        onAdd={legacyVP.add}
        onRemove={legacyVP.remove}
        onRemoveAll={legacyVP.removeAll}
      />
    </div>
  );
};

export default ThreeWorkspace;
