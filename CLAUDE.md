# CLAUDE.md — KD_Viz

Context for future sessions. This is a greenfield Electron app built from an
empty folder.

## What this is
A fullscreen generative-art visualizer driven by live macOS system activity
(per-core CPU, RAM, swap, GPU, network, disk I/O, temps, processes). It's the
intended **always-on default app** on a dedicated Mac mini used as an
agentic-work machine, viewed on a small dock monitor as an at-a-glance health
check. Every signal maps to a unique color/shape; several switchable artistic
modes span light → heavy performance tiers so the visualizer never starves the
workload it monitors.

## Commands
- `npm run dev` — windowed + devtools (for iterating)
- `npm start` — fullscreen kiosk (production behavior)
- `npm run setup-gpu` — one-time passwordless `powermetrics` sudoers entry (GPU/thermal level)
- `npm run build-helper` — compile `bin/thermo` (Apple Silicon die-temp reader)
- `npm run make-icon` — regenerate `build/icon.icns`
- `npm run package` — build `dist/KD_Viz.app`

## Architecture
- **Main** (`src/main/`): `metrics/collector.js` samples `systeminformation`
  (~1 Hz); `metrics/powermetrics.js` streams `sudo powermetrics` for GPU + thermal-
  pressure level; `metrics/appleTemp.js` spawns the `bin/thermo` Swift helper
  (`src/native/thermo.swift`) for real die temperature via IOKit thermal sensors;
  `metrics/signals.js` normalizes to 0..1, EMA-smooths, keeps rolling baselines +
  anomaly flags, and emits a signal frame over IPC. `window.js` = full-screen
  window (macOS *simple* fullscreen, NOT kiosk — kiosk breaks Cmd-Tab/Mission
  Control/Spaces) + powerSaveBlocker + Esc-to-quit; `index.js` wires it together
  (single-instance lock).
  `metrics/claudeUsage.js` tails Claude Code transcripts in `~/.claude/projects`
  (byte-offset incremental reads) for machine-wide token cost/throughput + the
  active session's context-%, attached to each frame as `frame.claude`.
- **Renderer** (`src/renderer/`): `signalBus.js` holds latest frame + history;
  `modeManager.js` owns the active mode, number-key switching, and status-reactive
  auto-switch; each `modes/*.js` is one self-contained visual implementing
  `{ id, init, update, render, teardown }`. `claudeBar.js` renders the persistent
  Claude token-usage overlay (DOM, not canvas) shown across all modes.

## Modes
Keys: `1` pulse (light, default), `2` constellation, `3` dashboard,
`4` monitor (Activity Monitor spin: process leaderboard + CPU-history grid +
mem pressure + net/disk graphs), `5` flowfield (heavy WebGL), `6` odyssey
(heavy WebGL — 2001 Star Gate: celestial starfield that warps into a
kaleidoscopic hyperspace tunnel as load climbs), `7` face (heavy WebGL — a
raymarched SDF head: CPU→cranium neurons, GPU→eyes, network→mouth, netDown→ears,
temp→cheeks flush red, fan→blue cooling wisps fighting the flush, disk R/W→spokes
in/out of the head). Auto-only states:
**disconnected** (network loss) and **alert** (thermal anomaly). `h` toggles
HUD; `c` toggles the Claude token-usage bar; `b` cycles budget view (5h ↔ week); `m` moves to the next display;
`Esc` quits. Window launches on the display under the cursor
(`getDisplayNearestPoint`).

## Claude token bar
A persistent top overlay (all modes) showing context-window %, today's cost +
tokens, and live throughput — read machine-wide from `~/.claude/projects`
transcripts. Pricing in `config/default.json` → `claude.pricing` ($/MTok per
family; cache read 0.1×, cache write 1.25× 5m / 2× 1h, split read per turn).

## Config
Everything tunable is in `config/default.json` (palettes, thresholds, FPS caps,
normalization maxima, auto-switch rules) — no rebuild needed.

## Gotchas / decisions (don't relearn these)
- **Electron extract-zip is broken in this sandbox.** `npm install` and
  electron-packager both produce a *stub* Electron.app missing Frameworks. Fix:
  extract the cached zip with `ditto` (see history) and write
  `node_modules/electron/path.txt`. `scripts/build-app.sh` packages by copying
  the working runtime with `ditto` for this reason — do NOT switch to
  electron-packager.
- **Disk = IOPS, not bytes** on macOS via systeminformation. Disk signals track
  I/O ops/sec (normalized by `diskOpsPerSecMax`).
- **Net/disk/proc rates are deltas** — first sample reads 0; need 2+ samples.
- **Canvas context type is sticky.** A `<canvas>` can't switch between `2d` and
  `webgl`, so `modeManager` swaps in a fresh canvas element on every mode change.
- **`?? ` not `||`** for config numbers that can legitimately be 0 (e.g.
  `userOverrideMs`).
- GPU/thermal degrade gracefully when the sudoers entry is absent
  (`gpuAvailable:false`, HUD notes it).
- **`smc` is NOT a valid powermetrics sampler on Apple Silicon** — including it
  makes the whole command fail (`unrecognized sampler`). Valid: gpu_power,
  thermal, cpu_power. GPU active = `1 - gpu.idle_ratio` (scope the regex to the
  `<key>gpu</key>` dict — cpu_power emits cluster `idle_ratio` too).
- **Die temperature on Apple Silicon** isn't in powermetrics; `bin/thermo`
  (Swift, IOKit `IOHIDEventSystemClient`, no sudo) reads the `PMU tdie*` sensors
  and streams JSON. `signals.js` handles temp/thermal independent of GPU
  availability, so temp works even without the powermetrics sudoers entry.
- **No per-GPU-core data on Apple Silicon** — powermetrics aggregates all cores
  into one residency. The `gpu` dict's `dvfm_states` (per-clock-frequency
  residency) IS available — parsed into `frame.gpuStates` and shown as the
  Monitor mode's GPU clock spectrum (the real substitute for "per-core").
- **Fan RPM via SMC** (`bin/thermo` also reads `FNum`/`F0Ac`/`F0Mn`/`F0Mx`).
  The SMC works on Apple Silicon ONLY with the correct **80-byte** `SMCParamStruct`
  — it needs a `padding: UInt16` after `keyInfo`; without it the kernel returns
  `kIOReturnBadArgument 0xe00002c2`. (Layout credit: agoodkind/macos-smc-fan,
  via ProducerGuy/ThermalForge, MIT.) Fan normalized as (rpm−min)/(max−min).
- **GPU utilization is frequency-weighted**, NOT raw active residency. Residency
  (`1 - idle_ratio`) pins high for any activity; the real 0..100 metric is
  `Σ(dvfm used_ratio_i · freq_i) / maxFreq` (computed in `parseGpu`). Raw
  residency kept as `gpuResidency`.
- **Temp display unit** is `config.tempUnit` (`"F"` default / `"C"`); converted
  only at display (`fmtTemp` in `hud.js`), signal stays in °C.
- **Thermal ALERT** fires only on `tempC >= autoSwitch.thermal.hardTempC` (107°C
  ≈ 225°F) OR macOS thermal-pressure Serious+. The statistical temp-anomaly
  trigger was removed — it tripped on any sustained load.

## Verifying visuals
Screen Recording permission may be ungranted (computer-use screenshots blocked).
Instead, verify with a throwaway Electron harness that feeds frames to the real
renderer and uses `webContents.capturePage()` → PNG in `/tmp/viz_shots/` (no
screen-recording permission needed). Delete the harness after use.

## Known bugs / backlog
- **Low priority: screen can go blank when moving to another display with `m`.**
  Mitigations shipped (synchronous simple-fullscreen toggle in `window.js`;
  self-healing per-frame canvas size check `modeManager.ensureSize()` for DPR
  changes; WebGL context-loss recovery in flowfield/odyssey). Not yet confirmed
  fixed on real dual-monitor hardware. When revisiting, ask: does the app window
  go black, or the whole second monitor? Which mode? That disambiguates render
  path vs macOS presentation-options.

## Status
All 8 modes verified rendering (real + synthetic data); auto-switch both paths
verified; packaged `.app` builds and launches; simple-fullscreen + Esc-quit
shipped. Possible next steps the user floated: menu-bar mode picker; polish the
Dashboard's per-core strip / HUD overlap.
