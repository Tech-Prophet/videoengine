import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { downloadProject } from "./backup.ts";

// Shows a calm message instead of a blank page if something in the app crashes. The project is saved in the browser as you work,
// so reloading normally brings it straight back; the backup button keeps a copy first.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; saved: boolean | null }> {
  state = { failed: false, saved: null as boolean | null };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error("App crashed:", err, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }} className="space-y-3 text-sm text-slate-300">
          <h1 className="text-base font-semibold text-white">Something went wrong</h1>
          <p>Your script and settings are saved in this browser. Reload to carry on.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white" onClick={() => window.location.reload()}>Reload</button>
            <button className="rounded-md border border-slate-600 px-4 py-2" onClick={() => this.setState({ saved: downloadProject() })}>Download a backup first</button>
          </div>
          {this.state.saved === false && <p className="text-xs text-slate-400">There is no saved project to back up yet.</p>}
        </div>
      </div>
    );
  }
}
