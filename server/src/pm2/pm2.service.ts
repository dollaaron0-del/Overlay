import pm2 from "pm2";
import type { ProcessDescription, StartOptions } from "pm2";

let connected: Promise<void> | null = null;

export function ensureConnected(): Promise<void> {
  if (!connected) {
    connected = new Promise((resolve, reject) => {
      pm2.connect((err) => (err ? reject(err) : resolve()));
    });
  }
  return connected;
}

export async function listProcesses(): Promise<ProcessDescription[]> {
  await ensureConnected();
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => (err ? reject(err) : resolve(list)));
  });
}

export async function describeProcess(name: string): Promise<ProcessDescription | undefined> {
  await ensureConnected();
  return new Promise((resolve, reject) => {
    pm2.describe(name, (err, list) => (err ? reject(err) : resolve(list[0])));
  });
}

export async function startProcess(opts: StartOptions): Promise<void> {
  await ensureConnected();
  return new Promise((resolve, reject) => {
    pm2.start(opts, (err) => (err ? reject(err) : resolve()));
  });
}

export async function stopProcess(name: string): Promise<void> {
  await ensureConnected();
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err) => (err ? reject(err) : resolve()));
  });
}

export async function restartProcess(name: string): Promise<void> {
  await ensureConnected();
  return new Promise((resolve, reject) => {
    pm2.restart(name, (err) => (err ? reject(err) : resolve()));
  });
}

export function statusOf(desc: ProcessDescription | undefined): "online" | "stopped" | "errored" | "unknown" {
  if (!desc || !desc.pm2_env) return "unknown";
  const status = (desc.pm2_env as { status?: string }).status;
  if (status === "online") return "online";
  if (status === "stopped" || status === "stopping") return "stopped";
  if (status === "errored") return "errored";
  return "unknown";
}
