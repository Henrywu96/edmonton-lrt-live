# Edmonton LRT Live (v2)

Every Edmonton LRT train — Capital, Metro and Valley lines — moving on a real street map as a little 3D model,
in Edmonton time. Click a train to see where it is going and its stops, or a station for its next departures.

This is the framework rewrite of the single-file version: a **Vite + React + TypeScript** app with a
**MapLibre GL** map and the trains drawn by **three.js** inside the map. The timetable comes from the official
**ETS GTFS feed**, which a GitHub Action downloads and compacts every day.

> Train positions are worked out from the published timetable, not from GPS. They show where each train is
> scheduled to be, so a delayed train will not appear late here.

## How it works

```
ETS GTFS feed (zip, all buses and trains)
        │  scripts/build-gtfs.mjs  (GitHub Actions, daily)
        ▼
public/data/lrt.json  (a few hundred KB at most: lines, stations, track shapes, every LRT trip, calendar)
        │  fetched once by the browser
        ▼
src/lib/schedule.ts   which trips run today → trains (GTFS blocks) → where each train is at time t
        │  every animation frame
        ▼
src/map/TrainLayer.ts three.js custom layer inside MapLibre: instanced toy trains, one draw call per part
src/components/*      React UI: clock, line counts, train list, train card, station departure board
```

| Part | Technology |
| --- | --- |
| Build tool | Vite 7 |
| UI | React 19 + TypeScript |
| Map | MapLibre GL JS 5 with OpenFreeMap vector tiles (OpenStreetMap data, no API key) |
| 3D trains | three.js, as a MapLibre custom layer sharing the map's WebGL context and depth buffer |
| Timetable | ETS GTFS static feed, compacted by a Node script |
| Hosting | GitHub Pages, deployed by GitHub Actions |

Details worth knowing:

- **Smooth motion.** Between stations each train follows an S-shaped speed curve (gentle start, cruise, gentle
  stop), track geometry is resampled into an even table, and the clock advances by the real frame time. All
  positions are computed in double precision relative to the middle of the network, so trains do not jitter
  even when zoomed right in.
- **Trains as vehicles.** Trips are linked into trains using GTFS `block_id` (or, if the feed has none, by turning
  trains back at the terminus first-in-first-out). A train waits on the platform before departure and stands for
  a moment after arriving; platform waits are shortened when another train needs the same platform.
- **Readable at any zoom.** Trains are true scale when you zoom in and grow into chunky "toy" models when you zoom
  out, so the whole network stays legible.
- **Underground sections** (downtown and University) are drawn as dashed lines with see-through trains. They are
  worked out from the station names (GTFS does not say which parts are in tunnel).
- **Day / night.** In *Auto* the map switches to the dark style between dusk and dawn in Edmonton.
- **Holidays** are handled by the GTFS calendar. If the timetable file does not cover a date, the same weekday from
  the nearest covered week is used and the app says so.

## Run it on your computer

Requires Node.js 20.19+ (22 recommended).

```bash
npm install
npm run dev        # downloads the GTFS feed the first time, then starts http://localhost:5173
npm run data       # refresh the timetable (public/data/lrt.json)
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run typecheck  # TypeScript check
```

`npm run data` options: `--file path/to/GTFS.zip` to build from a local copy of the feed, `--out <file>`,
and the `GTFS_URL` environment variable to use a different download address.

### URL parameters

| Parameter | Example | Effect |
| --- | --- | --- |
| `at` | `?at=2026-10-14T08:15` | start at a given Edmonton date and time instead of now |
| `speed` | `?speed=60` | start playing faster (1, 10, 60 …) |
| `basemap` | `?basemap=dark` | force a map style: `light`, `gray`, `dark`, or `none` (no tiles, works offline) |

Keyboard: <kbd>Space</kbd> pause · <kbd>N</kbd> back to now · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> speed ·
<kbd>←</kbd> <kbd>→</kbd> ±10 min · <kbd>R</kbd> follow a random train · <kbd>F</kbd> follow the selected
train · <kbd>O</kbd> whole network · <kbd>D</kbd> downtown · <kbd>T</kbd> 2D/3D · <kbd>Esc</kbd> close.

## Project layout

```
.github/workflows/deploy.yml   build + deploy to GitHub Pages (push, daily, manual)
scripts/build-gtfs.mjs         GTFS feed → public/data/lrt.json
src/
  App.tsx, main.tsx            React entry: loads the timetable, lays out the HUD
  engine.ts                    owns map, clock, timetable and train layer; runs the frame loop
  config.ts                    map styles, rolling stock per line, tunnel sections, timings
  lib/schedule.ts              service calendar, trains from trips, train state at any time
  lib/network.ts               lines, stations, track geometry, route lines for the map
  lib/geo.ts                   local metric frame matching MapLibre's Mercator, resampled paths
  lib/time.ts, clock.ts, sun.ts  Edmonton time, simulation clock, sunrise/sunset
  map/TrainLayer.ts            three.js custom layer
  map/trainModels.ts           train models in real ETS liveries (Siemens U2 / SD160, Flexity Freedom)
  map/TrainLabels.ts           name tags above the trains
  map/layers.ts                route, station and label layers
  components/                  TopBar, LinePanel, Inspector, Toolbar, keyboard shortcuts
```

## Next step: real-time positions

ETS also publishes **GTFS-Realtime** feeds (vehicle positions, trip updates, alerts). A web page generally cannot
read them directly (they are binary protobuf files at `http://` addresses, which an `https://` page may not load),
so they need a small proxy — for example a Cloudflare Worker or Vercel function that fetches the feed every
15–30 s and returns JSON. The schedule
engine already keeps GTFS `trip_id`s, so delays from trip updates can be applied to the timetable positions.

## Credits

- Timetable: [Edmonton Transit Service GTFS](https://data.edmonton.ca/), City of Edmonton Open Government Licence.
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by
  [OpenFreeMap](https://openfreemap.org/) / [OpenMapTiles](https://openmaptiles.org/).
- Libraries: MapLibre GL JS (BSD-3-Clause), three.js (MIT), React (MIT), Vite (MIT).

This is an unofficial fan project and is not affiliated with the City of Edmonton or ETS.
