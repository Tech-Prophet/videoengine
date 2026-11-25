import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './tailwind.css' // generated from the classes used in the app (see README); loaded after index.css like the old runtime styles were
import Gate from './Gate.tsx'
import Studio from './Studio.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Gate>
        <Studio />
      </Gate>
    </ErrorBoundary>
  </StrictMode>,
)
