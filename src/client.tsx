import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ThreeWorkspace from './canvas'

const rootElement = document.getElementById('root') || (() => {
  const div = document.createElement('div');
  div.id = 'root';
  document.body.appendChild(div);
  return div;
})();

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <ThreeWorkspace />
  </StrictMode>
);


