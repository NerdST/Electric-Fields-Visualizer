import React from 'react'
import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';
import ThreeWorkspace from './scripts/ThreeWorkspace';

const ThreeCanvas = () => {
  const [count, setCount] = useState(0);

  return (
    <ThreeWorkspace />
  );
}

export default ThreeCanvas