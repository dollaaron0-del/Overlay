import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CpuHealthSnapshot {
  timestamp: string;
  tctlC: number | null;
  tccd1C: number | null;
  cpuTinC: number | null;
  fan2Rpm: number | null;
  fan3Rpm: number | null;
  load1: number;
  load5: number;
  load15: number;
  memUsedMb: number;
  memAvailMb: number;
  pingMs: number | null;
  pingLossPct: number | null;
}

function parseSensorValue(output: string, label: string): number | null {
  const match = output.match(new RegExp(`${label}:\\s*([+-]?[0-9.]+)`));
  return match ? parseFloat(match[1]) : null;
}

function parseFanRpm(output: string, label: string): number | null {
  const match = output.match(new RegExp(`^${label}:\\s*([0-9]+)`, "m"));
  return match ? parseInt(match[1], 10) : null;
}

interface SensorReadings {
  tctlC: number | null;
  tccd1C: number | null;
  cpuTinC: number | null;
  fan2Rpm: number | null;
  fan3Rpm: number | null;
}

async function readSensors(): Promise<SensorReadings> {
  try {
    const { stdout } = await execFileAsync("sensors", [], { timeout: 5000 });
    return {
      tctlC: parseSensorValue(stdout, "Tctl"),
      tccd1C: parseSensorValue(stdout, "Tccd1"),
      cpuTinC: parseSensorValue(stdout, "CPUTIN"),
      fan2Rpm: parseFanRpm(stdout, "fan2"),
      fan3Rpm: parseFanRpm(stdout, "fan3"),
    };
  } catch {
    // lm-sensors not installed, or no permission — degrade to nulls rather
    // than failing the whole snapshot (load/mem/ping are still useful alone).
    return { tctlC: null, tccd1C: null, cpuTinC: null, fan2Rpm: null, fan3Rpm: null };
  }
}

interface PingReadings {
  pingMs: number | null;
  pingLossPct: number | null;
}

// -c 2 -W 1: two probes, 1s timeout each — bounds this at ~2s worst case so
// polling /health/current from the widget never stalls noticeably.
async function readPing(): Promise<PingReadings> {
  try {
    const { stdout } = await execFileAsync("ping", ["-c", "2", "-W", "1", "1.1.1.1"], { timeout: 4000 });
    const avgMatch = stdout.match(/= [0-9.]+\/([0-9.]+)\//);
    const lossMatch = stdout.match(/([0-9]+)% packet loss/);
    return {
      pingMs: avgMatch ? parseFloat(avgMatch[1]) : null,
      pingLossPct: lossMatch ? parseInt(lossMatch[1], 10) : null,
    };
  } catch {
    // Includes the "100% packet loss" case, where ping exits non-zero.
    return { pingMs: null, pingLossPct: null };
  }
}

export async function captureCpuHealthSnapshot(): Promise<CpuHealthSnapshot> {
  const [sensors, ping] = await Promise.all([readSensors(), readPing()]);
  const [load1, load5, load15] = os.loadavg();
  const totalMb = os.totalmem() / 1024 / 1024;
  const freeMb = os.freemem() / 1024 / 1024;
  return {
    timestamp: new Date().toISOString(),
    ...sensors,
    load1,
    load5,
    load15,
    memUsedMb: Math.round(totalMb - freeMb),
    memAvailMb: Math.round(freeMb),
    ...ping,
  };
}
