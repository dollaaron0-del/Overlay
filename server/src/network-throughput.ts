import fs from "node:fs/promises";

export interface NetworkThroughput {
  /** Bytes per second received across physical interfaces, or null before the first delta is known. */
  rxBytesPerSec: number | null;
  /** Bytes per second transmitted across physical interfaces, or null before the first delta is known. */
  txBytesPerSec: number | null;
  timestamp: string;
}

// Loopback plus the usual virtual-interface prefixes (containers, bridges,
// VM taps) — none of that is "the internet connection", so it's excluded
// from the sum. What's left on this host is the Wi-Fi adapter.
const IGNORED_PREFIXES = ["lo", "veth", "docker", "br-", "virbr", "tap", "vnet"];

function isPhysical(iface: string): boolean {
  return !IGNORED_PREFIXES.some((p) => iface === p || iface.startsWith(p));
}

interface Counters {
  rx: number;
  tx: number;
}

/** Sum rx/tx byte counters from /proc/net/dev across physical interfaces. */
async function readCounters(): Promise<Counters> {
  const raw = await fs.readFile("/proc/net/dev", "utf8");
  let rx = 0;
  let tx = 0;
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const iface = line.slice(0, colon).trim();
    if (!isPhysical(iface)) continue;
    const fields = line.slice(colon + 1).trim().split(/\s+/);
    // Receive bytes is field 0, transmit bytes is field 8.
    rx += Number(fields[0]) || 0;
    tx += Number(fields[8]) || 0;
  }
  return { rx, tx };
}

const SAMPLE_INTERVAL_MS = 2000;

let last: { counters: Counters; at: number } | null = null;
let current: NetworkThroughput = {
  rxBytesPerSec: null,
  txBytesPerSec: null,
  timestamp: new Date().toISOString(),
};

async function sample(): Promise<void> {
  const counters = await readCounters();
  const at = Date.now();
  if (last) {
    const seconds = (at - last.at) / 1000;
    if (seconds > 0) {
      // Counters can wrap or reset (interface down/up); clamp negatives to 0.
      current = {
        rxBytesPerSec: Math.max(0, Math.round((counters.rx - last.counters.rx) / seconds)),
        txBytesPerSec: Math.max(0, Math.round((counters.tx - last.counters.tx) / seconds)),
        timestamp: new Date(at).toISOString(),
      };
    }
  }
  last = { counters, at };
}

/**
 * Background sampler for live network throughput. Runs regardless of whether
 * the Server-Status widget is open, so the first reading is ready as soon as
 * a client asks. Cheap: one small /proc read every couple of seconds.
 */
export function startNetworkThroughputSampler(): void {
  const tick = () => {
    void sample().catch((err) => console.error("[network-throughput] sample failed", err));
  };
  tick();
  setInterval(tick, SAMPLE_INTERVAL_MS);
}

export function getNetworkThroughput(): NetworkThroughput {
  return current;
}
