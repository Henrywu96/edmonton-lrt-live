import type { StyleMode } from '../config';
import type { Engine, Snapshot } from '../engine';

const SPEEDS = [1, 10, 60];
const STYLES: { id: StyleMode; label: string }[] = [
  { id: 'auto', label: 'Auto (day/night)' },
  { id: 'light', label: 'Street map' },
  { id: 'gray', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
const fmt = (sec: number) => {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function Toolbar({ snap, engine, panelOpen, onTogglePanel }: { snap: Snapshot; engine: Engine; panelOpen: boolean; onTogglePanel: () => void }) {
  return (
    <div className="hud toolbar glass" role="toolbar" aria-label="Time and view">
      <button type="button" className="mobile-only" aria-pressed={panelOpen} onClick={onTogglePanel}>
        Trains
      </button>
      <div className="seg" aria-label="Time">
        <span className="seg-label">Time</span>
        <button type="button" className="btn-now" aria-pressed={snap.live} title="Back to the real time (N)" onClick={() => engine.goLive()}>
          Now
        </button>
        <button type="button" className="btn-play" aria-pressed={snap.paused} title="Pause (Space)" onClick={() => engine.togglePause()}>
          {snap.paused ? 'Play' : 'Pause'}
        </button>
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={!snap.paused && snap.speed === s} title={`${s}× speed`} onClick={() => engine.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="seg scrub" aria-label="Time of day">
        <button type="button" title="Back 10 minutes (←)" onClick={() => engine.shift(-600)}>
          −10m
        </button>
        <input
          type="range"
          min={4 * 3600}
          max={27 * 3600}
          step={60}
          value={Math.min(27 * 3600, Math.max(4 * 3600, snap.scrub))}
          aria-label="Time of day"
          aria-valuetext={fmt(snap.scrub)}
          onChange={(e) => engine.setTimeOfDay(Number(e.target.value))}
        />
        <button type="button" title="Forward 10 minutes (→)" onClick={() => engine.shift(600)}>
          +10m
        </button>
      </div>
      <div className="seg" aria-label="View">
        <span className="seg-label">View</span>
        <button type="button" title="Whole network (O)" onClick={() => engine.view('network')}>
          Network
        </button>
        <button type="button" title="Downtown (D)" onClick={() => engine.view('downtown')}>
          Downtown
        </button>
        <button type="button" title="Tilt between 2D and 3D (T)" onClick={() => engine.view('tilt')}>
          {snap.pitched ? '2D' : '3D'}
        </button>
      </div>
      <label className="seg style-pick">
        <span className="seg-label">Map</span>
        <select value={snap.styleMode} onChange={(e) => engine.setStyleMode(e.target.value as StyleMode)} aria-label="Map style">
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="primary" title="Follow a random train (R)" onClick={() => engine.followRandom()}>
        Follow a train
      </button>
    </div>
  );
}
