import { useState, type CSSProperties, type FormEvent } from 'react';
import type { Engine, Snapshot } from '../engine';

export const Bullet = ({ color, short, small }: { color: string; short: string; small?: boolean }) => (
  <i className={small ? 'bul sm' : 'bul'} style={{ '--c': color } as CSSProperties}>
    {short}
  </i>
);

export function TopBar({ snap, engine }: { snap: Snapshot; engine: Engine }) {
  const [q, setQ] = useState('');
  const state = snap.live ? 'LIVE' : snap.paused ? 'PAUSED' : snap.speed === 1 ? 'REPLAY' : `×${snap.speed}`;
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const s = q.trim().toLowerCase();
    if (!s) return;
    const hit = snap.stations.find((st) => st.name.toLowerCase() === s) ?? snap.stations.find((st) => st.name.toLowerCase().includes(s));
    if (hit) {
      engine.selectStation(hit.idx, true);
      setQ('');
      (document.activeElement as HTMLElement | null)?.blur();
    } else engine.say(`No station matches “${q.trim()}”`);
  };
  return (
    <header className="hud topbar">
      <div className="brand glass">
        <div className="logo" aria-hidden="true">
          <span>LRT</span>
        </div>
        <div className="brand-text">
          <div className="brand-name">Edmonton LRT Live</div>
          <div className="brand-sub">
            {snap.service}
            <span className="est" title="Positions are worked out from the ETS GTFS timetable, not GPS">
              TIMETABLE
            </span>
          </div>
        </div>
        <div className="clock">
          <span className="clock-time tab">{snap.clock}</span>
          <span className={snap.live ? 'clock-state live' : 'clock-state'}>{state}</span>
        </div>
      </div>
      <div className="kpis glass" aria-label="Trains on the network">
        <div className="kpi">
          <span className="k-label">Trains running</span>
          <span className="k-val tab">{snap.total}</span>
          <span className="k-sub">{snap.date}</span>
        </div>
        {snap.lines.map((l) => (
          <div className="kpi" key={l.id}>
            <span className="k-label">
              <Bullet color={l.color} short={l.short} small />
              {l.name.replace(/ Line$/, '')}
            </span>
            <span className="k-val tab">{l.count}</span>
          </div>
        ))}
      </div>
      <form className="search glass" role="search" onSubmit={onSearch}>
        <input value={q} onChange={(e) => setQ(e.target.value)} list="station-list" placeholder="Find a station" autoComplete="off" aria-label="Find a station" />
        <datalist id="station-list">
          {snap.stations.map((s) => (
            <option key={s.idx} value={s.name} />
          ))}
        </datalist>
        <button type="submit">Go</button>
      </form>
    </header>
  );
}
