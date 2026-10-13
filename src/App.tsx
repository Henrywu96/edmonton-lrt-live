import { useEffect, useRef, useState } from 'react';
import type { BasemapKey } from './config';
import { Engine } from './engine';
import { useStore } from './lib/store';
import type { LrtData } from './types';
import { Inspector } from './components/Inspector';
import { LinePanel } from './components/LinePanel';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { useShortcuts } from './components/useShortcuts';

const BASEMAP_PARAM: BasemapKey[] = ['light', 'gray', 'dark', 'none'];

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL}data/lrt.json`;
    fetch(url, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status}).`);
        return r.json() as Promise<LrtData>;
      })
      .then((data) => {
        if (!alive) return;
        if (!data.trips?.length) throw new Error('The timetable file has no LRT trips.');
        const q = new URLSearchParams(window.location.search);
        const bm = q.get('basemap') as BasemapKey | null;
        setEngine(
          new Engine(data, {
            at: Engine.parseAt(q.get('at'), data.timezone),
            speed: Number(q.get('speed')) || undefined,
            basemap: bm && BASEMAP_PARAM.includes(bm) ? bm : null,
          }),
        );
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error)
    return (
      <div className="splash">
        <div className="splash-card glass">
          <div className="logo" aria-hidden="true">
            <span>LRT</span>
          </div>
          <h1>Timetable not available</h1>
          <p>{error}</p>
          <p className="muted">
            The timetable is built from the ETS GTFS feed by <code>npm run data</code> (GitHub Actions does this on every deploy).
          </p>
        </div>
      </div>
    );
  if (!engine)
    return (
      <div className="splash">
        <div className="splash-card glass">
          <div className="logo spin" aria-hidden="true">
            <span>LRT</span>
          </div>
          <h1>Loading the timetable…</h1>
        </div>
      </div>
    );
  return <Main engine={engine} />;
}

function Main({ engine }: { engine: Engine }) {
  const snap = useStore(engine.store);
  const mapEl = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => engine.mount(mapEl.current!), [engine]);
  useEffect(() => {
    // handy in the browser console while developing: __lrt.clock, __lrt.map, __lrt.sched …
    if (import.meta.env.DEV) (window as unknown as { __lrt?: Engine }).__lrt = engine;
  }, [engine]);
  useShortcuts(engine);

  return (
    <div className="app">
      <div ref={mapEl} className="map" aria-label="Map of Edmonton with the LRT trains moving on it" />
      <TopBar snap={snap} engine={engine} />
      <LinePanel snap={snap} engine={engine} open={panelOpen} onPick={() => setPanelOpen(false)} />
      <Inspector snap={snap} engine={engine} />
      {snap.total === 0 && snap.detail === null && (
        <div className="hud quiet glass" role="status">
          <b>No trains are running right now</b>
          <p>{snap.nextService ? `First trains around ${snap.nextService}.` : 'LRT service runs from about 5 am until about 1 am, Edmonton time.'}</p>
          <div>
            <button type="button" onClick={() => engine.setTimeOfDay(8 * 3600)}>
              Show 8:00 am
            </button>
            <button type="button" onClick={() => engine.setTimeOfDay(17 * 3600)}>
              Show 5:00 pm rush
            </button>
          </div>
        </div>
      )}
      <Toolbar snap={snap} engine={engine} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((o) => !o)} />
      {snap.toast && (
        <div className="hud toast glass" role="status" key={snap.toast.id}>
          {snap.toast.text}
        </div>
      )}
    </div>
  );
}
