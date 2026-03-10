import { createRoot } from 'react-dom/client'
import './index.css'
// import App from './App.tsx'
// import ThreeCanvas from './canvas.tsx'
import ChargeCanvas from './scripts/ChargeImplementation.tsx'

createRoot(document.getElementById('root')!).render(
  <>
    {/* <App /> */}
    {/* <ThreeCanvas /> */}
    <ChargeCanvas />
  </>,
)
