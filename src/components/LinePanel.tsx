import type { Engine, Snapshot } from '../engine';
import { Bullet } from './TopBar';

export function LinePanel({ snap, engine, open, onPick }: { snap: Snapshot; engine: Engine; open: boolean; onPick: () => void }) {
  const selKey = snap.detail?.kind === 'train' ? snap.detail.key : null;
  const src = engine.data.source;
  const built = new Date(engine.data.generatedAt);
  return (
    <aside className={open ? 'hud panel left glass open' : 'hud panel left glass'} aria-label="Lines and trains">
      <section>
        <h2>Lines</h2>
        <div className="linetog">
          {snap.lines.map((l) => (
            <button key={l.id} type="button" aria-pressed={!l.hidden} onClick={() => engine.toggleLine(l.id)} title={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`}>
              <Bullet color={l.color} short={l.short} />
              <span>
                <b>{l.name}</b>
              </span>
              <em className="tab">{l.count}</em>
            </button>
          ))}
        </div>
      </section>
      <section className="sec-trains">
        <h2>
          Trains <span className="count">{snap.trains.length} on the map</span>
        </h2>
        {snap.trains.length === 0 ? (
          <p className="empty">No trains on the map at this time.</p>
        ) : (
          <ul className="trains">
            {snap.trains.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  className={t.key === selKey ? 'row on' : 'row'}
                  onClick={() => {
                    engine.selectTrain(t.key, true);
                    onPick();
                  }}
                >
                  <Bullet color={t.line.color} short={t.line.short} />
                  <span className="rid">{t.id}</span>
                  <span className="rdest">{t.headsign}</span>
                  <span className="rstat">
                    {t.status}
                    {t.ug ? <span className="ug-tag"> · tunnel</span> : null}
                  </span>
                  <span className="reta tab">{t.eta}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="sec-source">
        {snap.fallback && <p className="note warn">{snap.fallback}</p>}
        <p className="source">
          Timetable: {src.publisher ?? 'Edmonton Transit Service'} GTFS
          {src.feedStart && src.feedEnd ? ` (${fmtDate(src.feedStart)} – ${fmtDate(src.feedEnd)})` : ''}, built {built.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}. Train
          positions are estimated from the schedule.
        </p>
      </section>
    </aside>
  );
}

const fmtDate = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
