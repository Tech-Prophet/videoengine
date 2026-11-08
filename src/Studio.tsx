import { Suspense, lazy } from 'react'

// The studio itself is the bulk of the code. It is loaded only once the lock screen opens, so a visitor who is not signed in
// downloads just the small lock screen. A device that is already signed in starts fetching the studio straight away,
// in parallel with the access check, so it does not have to wait for the check to finish first.
const loadApp = () => import('./App.tsx')
const App = lazy(loadApp)
try { if (localStorage.getItem('vortex-access')) void loadApp() } catch { /* storage blocked: the lock screen asks for the code */ }

export default function Studio() {
  return (
    <Suspense
      fallback={
        <div role="status" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="text-sm text-slate-400">
          Loading the studio…
        </div>
      }
    >
      <App />
    </Suspense>
  )
}
