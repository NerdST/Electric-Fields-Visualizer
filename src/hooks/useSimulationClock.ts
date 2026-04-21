import { useCallback, useEffect, useRef, useState } from 'react';

export interface SimulationClock {
  timeSeconds: number;
  running: boolean;
  setRunning: (v: boolean | ((prev: boolean) => boolean)) => void;
  timeScale: number;
  setTimeScale: (v: number) => void;
  stepOnce: () => void;
}

/** Simulation-time state driven by requestAnimationFrame when `running` is true. */
export function useSimulationClock(): SimulationClock {
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const timeScaleRef = useRef(timeScale);
  useEffect(() => { timeScaleRef.current = timeScale; }, [timeScale]);

  useEffect(() => {
    if (!running) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
      const dt = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;
      setTimeSeconds((prev) => prev + dt * timeScaleRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [running]);

  const stepOnce = useCallback(() => {
    setTimeSeconds((prev) => prev + (1 / 120) * timeScaleRef.current);
  }, []);

  return { timeSeconds, running, setRunning, timeScale, setTimeScale, stepOnce };
}
