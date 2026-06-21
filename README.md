# KD_Viz

A fullscreen generative-art visualizer driven by live macOS system activity —
built to be the always-on default view on a dedicated Mac mini. Every signal
(per-core CPU, RAM, GPU, network, disk I/O, temps) maps to a unique shape and
color, across several switchable artistic modes. It's both pleasant to leave on
and a real at-a-glance health check on the machine.

## Run

```bash
npm install
npm run dev      # windowed, with devtools — for tweaking
npm start        # fullscreen kiosk — the real deal
```

> If `npm install` couldn't download Electron (offline/sandboxed), run it again
> with network access: `rm -rf node_modules/electron && npm install`.

## Modes

Switch with number keys; the bar at the bottom-right shows the active mode.

| Key | Mode | Tier | What it is |
|-----|------|------|-----------|
| `1` | **Pulse** | light | Calm breathing orbs, one per signal. Near-idle cost — the safe default to leave on under heavy agentic load. |
| `2` | **Constellation** | medium | Signal node-graph; network/disk traffic flows as particles along the edges. |
| `3` | **Dashboard** | medium | Dense labeled bars + sparklines + per-core CPU strip. The information-rich status view. |
| `4` | **Monitor** | medium | A spin on macOS Activity Monitor: live top-process leaderboard with heat-mapped CPU bars, the signature per-core CPU History grid, a **GPU clock spectrum** (per-frequency residency), a memory-pressure bar, and network/disk throughput graphs. |
| `5` | **Flow Field** | heavy | WebGL domain-warped noise field warped live by the signals. The bold showpiece — FPS-capped; use when the machine has headroom. |
| `6` | **Odyssey** | heavy | A *2001: A Space Odyssey* Star Gate. A calm celestial starfield when idle that dissolves into a hyperspace warp + kaleidoscopic light tunnel as usage climbs (CPU → warp speed, GPU → psychedelia, RAM → nebula, disk → flashes, temp → heat-shift). |
| `7` | **Face** | heavy | A raymarched 3D head that idles (sways, breathes, blinks) and flares per signal: **CPU** → neurons firing across the cranium, **GPU** → the glowing eyes, **network** → the talking mouth, **netDown** → the ears, **temp** → flushed cheeks, **fan** → blue cooling wisps that fight the thermal flush, **disk R/W** → light spokes streaming into / out of the head. |

Two modes activate **automatically** and can't be selected manually:

- **Disconnected** — when the network drops (no interface up + no traffic, sustained).
- **Alert** — when temperature / thermal pressure spikes above its rolling baseline (or a hard °C limit).

Both restore the previous mode when the condition clears. A manual key press
temporarily overrides auto-switching so it doesn't fight you.

### Keys
- `1`–`7` — select mode · `←` / `→` — cycle · `h` — toggle the HUD/labels · `c` — toggle the Claude token bar · `b` — cycle budget view (5h ↔ week) · `m` — move to next display · `Esc` — quit

## Claude token-usage bar

A persistent bar across the top (toggle with `c`) reads live Claude Code usage,
machine-wide, straight from the session transcripts in `~/.claude/projects` — no
API key needed:

- **Context %** — how full the *active* session's context window is (heat-colored
  green → amber → red), like Claude Code's built-in context indicator.
- **Today's cost + tokens** — cumulative $ and fresh tokens across *all* sessions
  on the machine. Cache reads are priced at 0.1× input; cache writes at 1.25×
  (5-min) / 2× (1-hour), with the 5m/1h split read from each turn.
- **Throughput** — fresh tokens/min right now, a pulse of how hard Claude is working.

  Note: If you want API usage too, you'd need to either pull from the Anthropic usage API (requires an API key in the app, which we deliberately avoided) or have your API-using code append entries to a local file in the same JSONL format.

Model pricing and context windows are in `config/default.json` under `claude.pricing`
(per-family: opus / sonnet / haiku / default) — edit if rates change.

## Temperature units

Temperatures display in **°F** by default. Set `"tempUnit": "C"` in
`config/default.json` for Celsius. (Internally the signal stays in °C; only the
readout converts.)

## Notes on Apple Silicon sensors

- **GPU**: `powermetrics` reports one aggregate GPU residency for the whole GPU —
  Apple Silicon does not expose per-GPU-core utilization. The Monitor mode's GPU
  clock spectrum visualizes the real per-*frequency*-state distribution instead.
- **Die temperature & fan RPM**: read by the bundled `bin/thermo` helper — die
  temps via IOKit thermal sensors, fan via AppleSMC — since `powermetrics`
  exposes neither on Apple Silicon. (SMC layout credit: agoodkind/macos-smc-fan
  via ProducerGuy/ThermalForge, MIT.)
- **GPU %** is a frequency-weighted capacity utilization (from the DVFM clock
  states), which spans 0–100 far more linearly than raw active residency.

## GPU & thermal (optional, needs one-time setup)

GPU utilization, package temperature and thermal pressure come from
`powermetrics`, which requires root. Grant passwordless, read-only access once:

```bash
npm run setup-gpu     # installs /etc/sudoers.d/visualizer-powermetrics (prompts for admin pw)
```

Without this the app still runs fine — GPU/thermal signals simply show as
unavailable and the HUD notes it. Remove later with
`sudo rm /etc/sudoers.d/visualizer-powermetrics`.

## Configuration

All thresholds, palettes, FPS caps, normalization maxima and auto-switch rules
live in [`config/default.json`](config/default.json) — no rebuild needed, just
edit and relaunch. Each signal's color/label/glyph is defined under `signals`;
each mode's performance tier and `fpsCap` under `modes`.

## Architecture

- **Main process** (`src/main/`) — samples metrics via `systeminformation`
  (`collector.js`) plus a long-lived `powermetrics` stream (`powermetrics.js`),
  normalizes/smooths them with rolling baselines + anomaly detection
  (`signals.js`), and pushes a signal frame to the renderer ~1×/sec.
- **Renderer** (`src/renderer/`) — a `signalBus` holds the latest frame +
  history; `modeManager` owns the active mode, keyboard switching and
  auto-switch rules; each file in `modes/` is one self-contained visual.

Note: on macOS, disk activity is reported as **I/O operations/sec** (not bytes),
which is what the disk signals track.

## Build a standalone `.app`

```bash
npm run make-icon   # regenerate build/icon.icns (only needed if you change the icon)
npm run package     # -> dist/KD_Viz.app
```

`scripts/build-app.sh` assembles the bundle from the local Electron runtime
(copied with `ditto`, ad-hoc signed) rather than electron-packager, because
`extract-zip` mis-extracts the Electron app in some sandboxes. The result is a
normal double-clickable `.app`.

> Not notarized. On first launch macOS Gatekeeper may need a right-click → Open,
> or: `xattr -dr com.apple.quarantine "dist/KD_Viz.app"`.

## Run at login (dedicated machine)

Drag **dist/KD_Viz.app** into **System Settings → General →
Login Items**. It opens fullscreen kiosk, hides the cursor when idle, and keeps
the display awake.
