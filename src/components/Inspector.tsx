import { useState, type CSSProperties } from 'react';
import type { Engine, Snapshot, StationDetail, TrainDetail } from '../engine';
import { Bullet } from './TopBar';

export function Inspector({ snap, engine }: { snap: Snapshot; engine: Engine }) {
  const [helpClosed, setHelpClosed] = useState(false);
  const d = snap.detail;
  if (!d) {
    if (helpClosed) return null;
    return (
      <aside className="hud panel right glass help" aria-label="About this map">
        <div className="insp-head">
          <div className="eyebrow">How to read the map</div>
          <button type="button" className="close" aria-label="Close" onClick={() => setHelpClosed(true)}>
            ×
          </button>
        </div>
        <ul className="legend">
          <li>
            <span className="sw-solid" /> Line on the surface or a bridge
          </li>
          <li>
            <span className="sw-dash" /> Line in tunnel
          </li>
          <li>
            <span className="sw-ghost" /> Train underground (see-through)
          </li>
          <li>
            <span className="sw-halo" /> Selected train
          </li>
        </ul>
        <p className="hint">Click a train to see where it is going, or a station for its next departures. Trains are drawn bigger than life when you zoom out.</p>
        <div className="keys">
          <span>
            <kbd>Space</kbd>pause
          </span>
          <span>
            <kbd>N</kbd>back to now
          </span>
          <span>
            <kbd>1</kbd>
            <kbd>2</kbd>
            <kbd>3</kbd>speed
          </span>
          <span>
            <kbd>R</kbd>random train
          </span>
          <span>
            <kbd>O</kbd>whole network
          </span>
          <span>
            <kbd>T</kbd>tilt 2D/3D
          </span>
        </div>
      </aside>
    );
  }
  return (
    <aside className="hud panel right glass" aria-live="polite">
      {d.kind === 'train' ? <TrainCard d={d} snap={snap} engine={engine} /> : <StationCard d={d} engine={engine} />}
    </aside>
  );
}

function TrainCard({ d, snap, engine }: { d: TrainDetail; snap: Snapshot; engine: Engine }) {
  const c = { '--c': d.line.color } as CSSProperties;
  return (
    <div style={c}>
      <div className="insp-head">
        <div className="eyebrow">
          <Bullet color={d.line.color} short={d.line.short} small />
          {d.line.name} · Train {d.id}
        </div>
        <button type="button" className="close" aria-label="Close" onClick={() => engine.clearSelection()}>
          ×
        </button>
      </div>
      <div className="insp-title">To {d.headsign}</div>
      <p className="status">
        <span className="s-head">
          {d.status}
          {d.ug ? ' · underground' : ''}
        </span>
        <small>{d.sub}</small>
      </p>
      {d.visible && (
        <>
          <div className="prog" aria-hidden="true">
            <i style={{ width: `${(d.progress * 100).toFixed(1)}%` }} />
            <b style={{ left: `${(d.progress * 100).toFixed(1)}%` }} />
          </div>
          <div className="prog-l">
            <span>{d.from}</span>
            <span>{d.to}</span>
          </div>
        </>
      )}
      <dl className="facts">
        <div>
          <dt>Speed</dt>
          <dd className="tab">{d.speed}</dd>
        </div>
        <div>
          <dt>Next trip</dt>
          <dd>{d.next ?? '—'}</dd>
        </div>
        <div className="wide">
          <dt>Cars</dt>
          <dd>{d.stock}</dd>
        </div>
        <div className="wide">
          <dt>GTFS trip</dt>
          <dd>
            <small>{d.tripId}</small>
          </dd>
        </div>
      </dl>
      <div className="actions">
        <button type="button" aria-pressed={snap.follow} disabled={!d.visible} onClick={() => engine.setFollow(!snap.follow)}>
          {snap.follow ? 'Following' : 'Follow'}
        </button>
        <button type="button" disabled={!d.visible} onClick={() => engine.selectTrain(d.key, true)}>
          Zoom to train
        </button>
      </div>
      {d.stops.length > 0 && (
        <ol className="stops">
          {d.stops.map((s, i) => (
            <li key={i} className={s.state}>
              <span>{s.name}</span>
              <time>{s.time}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StationCard({ d, engine }: { d: StationDetail; engine: Engine }) {
  return (
    <div>
      <div className="insp-head">
        <div className="eyebrow">
          {d.lines.map((l) => (
            <Bullet key={l.id} color={l.color} short={l.short} small />
          ))}
          Station
        </div>
        <button type="button" className="close" aria-label="Close" onClick={() => engine.clearSelection()}>
          ×
        </button>
      </div>
      <div className="insp-title">{d.name}</div>
      {d.here.length > 0 && (
        <div className="here">
          {d.here.map((h) => (
            <button type="button" key={h.key} className="chip" style={{ '--c': h.line.color } as CSSProperties} onClick={() => engine.selectTrain(h.key, true)}>
              <Bullet color={h.line.color} short={h.line.short} small />
              {h.id} to {h.headsign}
              {h.what ? <small> · {h.what}</small> : null}
            </button>
          ))}
        </div>
      )}
      <div className="board">
        {d.groups.length === 0 && <p className="hint">No more departures in the timetable today.</p>}
        {d.groups.map((g) => (
          <div className="bgrp" key={`${g.line.id}|${g.headsign}`}>
            <div className="bhead">
              <Bullet color={g.line.color} short={g.line.short} small />
              to {g.headsign}
            </div>
            {g.items.map((it, i) => (
              <div className="brow" key={i}>
                <span className={i === 0 ? 'soon' : ''}>{it.until}</span>
                <time>{it.time}</time>
                {it.key ? (
                  <button type="button" onClick={() => engine.selectTrain(it.key!, true)}>
                    Train
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="hint small">Scheduled times from the ETS timetable.</p>
    </div>
  );
}
