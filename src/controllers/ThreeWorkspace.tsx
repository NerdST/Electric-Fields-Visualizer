import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { createDefaultCharge, createCharge, electricFieldAt } from '../models/Charge';
import type { Charge } from '../models/Charge';
import { VectorFieldRenderer, createDefaultVectorFieldConfig } from '../views/VectorField';
import { createVoltagePoint } from '../models/VoltagePoint';
import type { VoltagePoint } from '../models/VoltagePoint';
import { SceneManager } from '../views/SceneManager';
import { ChargeMeshManager } from '../views/ChargeMeshManager';
import { VoltagePointMeshManager } from '../views/VoltagePointMeshManager';
import ControlPanel from '../views/ControlPanel';
import VoltagePointDialog from '../views/VoltagePointDialog';
import VoltagePointsList from '../views/VoltagePointsList';

// Initialize default charge
const charge1 = createDefaultCharge('charge-1');
charge1.position.set(0, 0, 0);
charge1.magnitude = 1e-6;

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const chargeMeshManagerRef = useRef<ChargeMeshManager | null>(null);
  const voltagePointMeshManagerRef = useRef<VoltagePointMeshManager | null>(null);
  const vectorFieldRendererRef = useRef<VectorFieldRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [showVectorField, setShowVectorField] = useState(true);
  const [chargesState, setChargesState] = useState<Charge[]>([charge1]);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [chargeStack, setChargeStack] = useState<string[]>([]);
  const [positionInputs, setPositionInputs] = useState({ x: '', y: '', z: '' });
  const [voltagePoints, setVoltagePoints] = useState<VoltagePoint[]>([]);
  const [showVoltagePointUI, setShowVoltagePointUI] = useState(false);
  const [newVoltagePoint, setNewVoltagePoint] = useState({ x: 0, y: 0, z: 0 });
  const [hoverVoltage, setHoverVoltage] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

  const chargesRef = useRef<Charge[]>(chargesState);
  const selectedChargeIdRef = useRef<string | null>(null);
  const isEditingPositionRef = useRef(false);
  const vectorFieldInitialized = useRef(false);
  const vfUpdateScheduled = useRef(false);

  useEffect(() => {
    chargesRef.current = chargesState;
  }, [chargesState]);

  useEffect(() => {
    if (!isEditingPositionRef.current && selectedCharge && selectedCharge.id !== selectedChargeIdRef.current) {
      selectedChargeIdRef.current = selectedCharge.id;
      setPositionInputs({
        x: selectedCharge.position.x.toString(),
        y: selectedCharge.position.y.toString(),
        z: selectedCharge.position.z.toString(),
      });
    } else if (!selectedCharge) {
      selectedChargeIdRef.current = null;
    }
  }, [selectedCharge?.id]);

  useEffect(() => {
    if (selectedCharge && !isEditingPositionRef.current) {
      const currentCharge = chargesState.find(c => c.id === selectedCharge.id);
      if (currentCharge && currentCharge.id === selectedChargeIdRef.current) {
        setSelectedCharge(currentCharge);
      }
    }
  }, [chargesState, selectedCharge?.id]);

  const scheduleVectorFieldUpdate = useCallback(
    (nextCharges: Charge[]) => {
      if (!vectorFieldRendererRef.current) return;
      if (vfUpdateScheduled.current) return;
      vfUpdateScheduled.current = true;
      requestAnimationFrame(() => {
        vfUpdateScheduled.current = false;
        if (vectorFieldRendererRef.current) {
          const shouldBeVisible = showVectorField;
          vectorFieldRendererRef.current.updateCharges(nextCharges);
          if (shouldBeVisible) {
            vectorFieldRendererRef.current.setVisible(true);
          }
        }
      });
    },
    [showVectorField],
  );

  // Charge management
  const addCharge = useCallback(() => {
    const newCharge = createCharge(
      new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      ),
      Math.random() > 0.5 ? 1e-6 : -1e-6,
      `charge-${Date.now()}`,
    );

    const newCharges = [...chargesState, newCharge];
    setChargesState(newCharges);
    setChargeStack((prev) => [...prev, newCharge.id]);
    
    if (chargeMeshManagerRef.current) {
      chargeMeshManagerRef.current.updateCharges(newCharges, selectedChargeIdRef.current);
    }
    scheduleVectorFieldUpdate(newCharges);
  }, [chargesState, scheduleVectorFieldUpdate]);

  const removeCharge = useCallback(
    (chargeId: string) => {
      const newCharges = chargesState.filter((charge) => charge.id !== chargeId);
      setChargesState(newCharges);
      setSelectedCharge(null);
      selectedChargeIdRef.current = null;
      setChargeStack((prev) => prev.filter((id) => id !== chargeId));

      if (chargeMeshManagerRef.current) {
        chargeMeshManagerRef.current.updateCharges(newCharges, null);
      }
      scheduleVectorFieldUpdate(newCharges);
    },
    [chargesState, scheduleVectorFieldUpdate],
  );

  const removeLastAdded = useCallback(() => {
    if (chargeStack.length > 0) {
      const lastChargeId = chargeStack[chargeStack.length - 1];
      removeCharge(lastChargeId);
    }
  }, [chargeStack, removeCharge]);

  const removeAllCharges = useCallback(() => {
    setChargesState([]);
    setSelectedCharge(null);
    setChargeStack([]);
    selectedChargeIdRef.current = null;
    
    if (chargeMeshManagerRef.current) {
      chargeMeshManagerRef.current.updateCharges([], null);
    }
    scheduleVectorFieldUpdate([]);
  }, [scheduleVectorFieldUpdate]);

  const selectCharge = useCallback(
    (chargeId: string) => {
      const charge = chargesState.find((c) => c.id === chargeId);
      if (charge) {
        setSelectedCharge(charge);
        selectedChargeIdRef.current = chargeId;
        if (chargeMeshManagerRef.current) {
          chargeMeshManagerRef.current.updateCharges(chargesState, chargeId);
        }
      }
    },
    [chargesState],
  );

  const updateChargeMagnitude = useCallback(
    (chargeId: string, magnitude: number) => {
      const newCharges = chargesState.map((charge) =>
        charge.id === chargeId ? { ...charge, magnitude } : charge,
      );
      setChargesState(newCharges);
      
      if (chargeMeshManagerRef.current) {
        chargeMeshManagerRef.current.updateCharges(newCharges, selectedChargeIdRef.current);
      }
      scheduleVectorFieldUpdate(newCharges);
    },
    [chargesState, scheduleVectorFieldUpdate],
  );

  const updateChargePosition = useCallback(
    (chargeId: string, position: THREE.Vector3) => {
      const newCharges = chargesState.map((charge) =>
        charge.id === chargeId ? { ...charge, position: position.clone() } : charge,
      );
      setChargesState(newCharges);
      
      if (chargeMeshManagerRef.current) {
        chargeMeshManagerRef.current.updateCharges(newCharges, selectedChargeIdRef.current);
      }
      if (vectorFieldRendererRef.current && showVectorField) {
        scheduleVectorFieldUpdate(newCharges);
      }
    },
    [chargesState, scheduleVectorFieldUpdate, showVectorField],
  );

  // Voltage point management
  const addVoltagePoint = useCallback(() => {
    const position = new THREE.Vector3(
      newVoltagePoint.x,
      newVoltagePoint.y,
      newVoltagePoint.z,
    );
    const fieldResult = electricFieldAt(position, chargesRef.current);
    const newPoint = createVoltagePoint(position, fieldResult.potential);
    const updated = [...voltagePoints, newPoint];
    setVoltagePoints(updated);
    
    if (voltagePointMeshManagerRef.current) {
      voltagePointMeshManagerRef.current.updateVoltagePoints(updated, chargesRef.current);
    }
    setShowVoltagePointUI(false);
  }, [newVoltagePoint, voltagePoints]);

  const removeVoltagePoint = useCallback(
    (pointId: string) => {
      const newPoints = voltagePoints.filter((point) => point.id !== pointId);
      setVoltagePoints(newPoints);
      
      if (voltagePointMeshManagerRef.current) {
        voltagePointMeshManagerRef.current.updateVoltagePoints(newPoints, chargesRef.current);
      }
    },
    [voltagePoints],
  );

  const removeAllVoltagePoints = useCallback(() => {
    setVoltagePoints([]);
    if (voltagePointMeshManagerRef.current) {
      voltagePointMeshManagerRef.current.updateVoltagePoints([], chargesRef.current);
    }
  }, []);

  const handleMouseClick = useCallback(
    (event: MouseEvent) => {
      if (!sceneManagerRef.current || !sceneManagerRef.current.controls) return;

      const renderer = sceneManagerRef.current.renderer;
      const camera = sceneManagerRef.current.camera;
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      
      const chargeMeshes = chargeMeshManagerRef.current?.getChargeMeshes() || [];
      const voltageMeshes = voltagePointMeshManagerRef.current?.getVoltagePointMeshes() || [];
      
      const chargeIntersects = raycaster.intersectObjects(chargeMeshes);
      const voltageIntersects = raycaster.intersectObjects(voltageMeshes);

      if (chargeIntersects.length > 0) {
        const clickedChargeId = chargeIntersects[0].object.userData.chargeId;
        selectCharge(clickedChargeId);
      } else if (voltageIntersects.length > 0) {
        console.log(
          'Voltage point clicked:',
          voltageIntersects[0].object.userData.voltagePointId,
        );
      } else {
        setShowVoltagePointUI(true);
        setSelectedCharge(null);
        selectedChargeIdRef.current = null;
        if (chargeMeshManagerRef.current) {
          chargeMeshManagerRef.current.updateCharges(chargesState, null);
        }
      }
    },
    [selectCharge, chargesState],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initialize scene manager
    const sceneManager = new SceneManager();
    sceneManagerRef.current = sceneManager;

    if (!container.contains(sceneManager.renderer.domElement)) {
      container.appendChild(sceneManager.renderer.domElement);
    }

    sceneManager.initializeControls(sceneManager.renderer.domElement);

    // Initialize mesh managers
    const chargeMeshManager = new ChargeMeshManager(sceneManager.scene);
    chargeMeshManagerRef.current = chargeMeshManager;
    chargeMeshManager.updateCharges(chargesState, null);

    const voltagePointMeshManager = new VoltagePointMeshManager(sceneManager.scene);
    voltagePointMeshManagerRef.current = voltagePointMeshManager;

    // Initialize vector field
    if (!vectorFieldInitialized.current) {
      const vectorFieldConfig = createDefaultVectorFieldConfig();
      const vfRenderer = new VectorFieldRenderer(sceneManager.scene, vectorFieldConfig);
      vfRenderer.updateCharges(chargesState);
      vfRenderer.setVisible(showVectorField);
      vectorFieldRendererRef.current = vfRenderer;
      vectorFieldInitialized.current = true;
    }

    const onResize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      sceneManager.resize(width, height);
    };

    onResize();
    window.addEventListener('resize', onResize);
    sceneManager.renderer.domElement.addEventListener('click', handleMouseClick);

    // Hover voltage tracking over plane y = 0
    const moveRaycaster = new THREE.Raycaster();
    const moveMouse = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const onMouseMove = (event: MouseEvent) => {
      const rect = sceneManager.renderer.domElement.getBoundingClientRect();
      moveMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      moveMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      moveRaycaster.setFromCamera(moveMouse, sceneManager.camera);
      const intersectionPoint = new THREE.Vector3();
      const result = moveRaycaster.ray.intersectPlane(plane, intersectionPoint);

      if (result !== null) {
        const pos = intersectionPoint.clone();
        setHoverPosition(pos);
        const fieldResult = electricFieldAt(pos, chargesRef.current);
        setHoverVoltage(fieldResult.potential);
      } else {
        setHoverPosition(null);
        setHoverVoltage(null);
      }
    };

    sceneManager.renderer.domElement.addEventListener('mousemove', onMouseMove);

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      sceneManager.render();
    };
    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      sceneManager.renderer.domElement.removeEventListener('click', handleMouseClick);
      sceneManager.renderer.domElement.removeEventListener('mousemove', onMouseMove);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (container.contains(sceneManager.renderer.domElement)) {
        container.removeChild(sceneManager.renderer.domElement);
      }
      
      if (vectorFieldRendererRef.current) {
        vectorFieldRendererRef.current.dispose();
      }
      
      if (chargeMeshManagerRef.current) {
        chargeMeshManagerRef.current.dispose();
      }
      
      if (voltagePointMeshManagerRef.current) {
        voltagePointMeshManagerRef.current.dispose();
      }
    };
  }, [handleMouseClick]);

  // Keep voltage point meshes in sync with state
  useEffect(() => {
    if (voltagePointMeshManagerRef.current) {
      voltagePointMeshManagerRef.current.updateVoltagePoints(voltagePoints, chargesRef.current);
    }
  }, [voltagePoints]);

  const toggleVectorField = () => {
    const newVisibility = !showVectorField;
    setShowVectorField(newVisibility);
    if (vectorFieldRendererRef.current) {
      vectorFieldRendererRef.current.setVisible(newVisibility);
    }
  };

  const handlePositionInputChange = (field: 'x' | 'y' | 'z', value: string) => {
    setPositionInputs((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: '#282c34' }}
      />
      
      <ControlPanel
        chargesCount={chargesState.length}
        hoverVoltage={hoverVoltage}
        hoverPosition={hoverPosition}
        showVectorField={showVectorField}
        selectedCharge={selectedCharge}
        positionInputs={positionInputs}
        chargeStackLength={chargeStack.length}
        onAddCharge={addCharge}
        onRemoveLastAdded={removeLastAdded}
        onRemoveAllCharges={removeAllCharges}
        onToggleVectorField={toggleVectorField}
        onAddVoltagePointClick={() => {
          setNewVoltagePoint({ x: 0, y: 0, z: 0 });
          setShowVoltagePointUI(true);
        }}
        onUpdateChargeMagnitude={updateChargeMagnitude}
        onUpdateChargePosition={updateChargePosition}
        onPositionInputChange={handlePositionInputChange}
        onPositionInputFocus={() => { isEditingPositionRef.current = true; }}
        onPositionInputBlur={() => { isEditingPositionRef.current = false; }}
      />

      {showVoltagePointUI && (
        <VoltagePointDialog
          newVoltagePoint={newVoltagePoint}
          onNewVoltagePointChange={(field, value) =>
            setNewVoltagePoint((prev) => ({ ...prev, [field]: value }))
          }
          onAddVoltagePoint={addVoltagePoint}
          onCancel={() => setShowVoltagePointUI(false)}
        />
      )}

      <VoltagePointsList
        voltagePoints={voltagePoints}
        onRemoveVoltagePoint={removeVoltagePoint}
        onRemoveAllVoltagePoints={removeAllVoltagePoints}
      />
    </div>
  );
};

export default ThreeWorkspace;
