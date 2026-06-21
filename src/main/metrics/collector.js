'use strict';

const si = require('systeminformation');

/**
 * Polls systeminformation for the no-privilege signals (CPU, memory, network,
 * disk, processes) on a fixed interval and hands each raw sample to `onSample`.
 * Returns a stop function.
 *
 * systeminformation's network/disk stats are deltas since the previous call,
 * so calling them on a steady interval yields per-second-ish rates directly.
 */
function startCollector(config, onSample) {
  const intervalMs = config.sampleIntervalMs || 1000;
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const [load, mem, net, disk, procs] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.networkStats(),
        si.disksIO().catch(() => null),
        si.processes().catch(() => null)
      ]);

      const intervalSec = intervalMs / 1000;

      // Network: sum across active interfaces, convert to bytes/sec.
      let rxSec = 0;
      let txSec = 0;
      let anyIfaceUp = false;
      if (Array.isArray(net)) {
        for (const n of net) {
          if (typeof n.rx_sec === 'number') rxSec += Math.max(0, n.rx_sec);
          if (typeof n.tx_sec === 'number') txSec += Math.max(0, n.tx_sec);
          if (n.operstate === 'up') anyIfaceUp = true;
        }
      }

      // Disk IO. On macOS, systeminformation exposes operations/sec (not bytes),
      // so we track IOPS — it moves with activity, which is what the visuals need.
      let diskReadOps = 0;
      let diskWriteOps = 0;
      if (disk) {
        if (typeof disk.rIO_sec === 'number') diskReadOps = Math.max(0, disk.rIO_sec);
        if (typeof disk.wIO_sec === 'number') diskWriteOps = Math.max(0, disk.wIO_sec);
      }

      const cores = Array.isArray(load.cpus)
        ? load.cpus.map((c) => Math.max(0, Math.min(100, c.load)) / 100)
        : [];

      // Top processes by CPU for the Activity Monitor mode.
      let topProcs = [];
      if (procs && Array.isArray(procs.list)) {
        topProcs = procs.list
          .slice()
          .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
          .slice(0, 8)
          .map((p) => ({
            pid: p.pid,
            name: shortName(p.name),
            cpu: Math.max(0, p.cpu || 0),
            mem: Math.max(0, p.mem || 0)
          }));
      }

      const raw = {
        t: Date.now(),
        cpuTotal: Math.max(0, Math.min(100, load.currentLoad)) / 100,
        cpuCores: cores,
        ramUsed: mem.total ? (mem.total - mem.available) / mem.total : 0,
        swapUsed: mem.swaptotal ? mem.swapused / mem.swaptotal : 0,
        netUpBytesSec: txSec,
        netDownBytesSec: rxSec,
        netIfaceUp: anyIfaceUp,
        diskReadOpsSec: diskReadOps,
        diskWriteOpsSec: diskWriteOps,
        procCount: procs ? procs.all : 0,
        topProcs,
        intervalSec
      };

      onSample(raw);
    } catch (err) {
      // Never let a transient sampling error kill the loop.
      // eslint-disable-next-line no-console
      console.error('[collector] sample failed:', err.message);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }

  tick();

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// Trim noisy process names (drop bundle-path prefixes, cap length) for display.
function shortName(name) {
  if (!name) return '—';
  let s = String(name);
  const slash = s.lastIndexOf('/');
  if (slash !== -1) s = s.slice(slash + 1);
  if (s.length > 22) s = s.slice(0, 21) + '…';
  return s;
}

module.exports = { startCollector };
