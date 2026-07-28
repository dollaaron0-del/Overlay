import pm2 from "pm2";
import fs from "node:fs";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import { ensureConnected, describeProcess } from "./pm2.service.js";

export interface LogLine {
  stream: "out" | "err";
  text: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let busLaunched: Promise<void> | null = null;

async function ensureBus(): Promise<void> {
  if (!busLaunched) {
    busLaunched = ensureConnected().then(
      () =>
        new Promise((resolve, reject) => {
          pm2.launchBus((err, bus) => {
            if (err) {
              reject(err);
              return;
            }
            bus.on("log:out", (packet: { process: { name: string }; data: string }) => {
              emitter.emit(packet.process.name, { stream: "out", text: packet.data } satisfies LogLine);
            });
            bus.on("log:err", (packet: { process: { name: string }; data: string }) => {
              emitter.emit(packet.process.name, { stream: "err", text: packet.data } satisfies LogLine);
            });
            resolve();
          });
        }),
    );
  }
  return busLaunched;
}

export async function subscribeToLogs(pm2Name: string, onLine: (line: LogLine) => void): Promise<() => void> {
  await ensureBus();
  const listener = (line: LogLine) => onLine(line);
  emitter.on(pm2Name, listener);
  return () => emitter.off(pm2Name, listener);
}

async function tailFile(filePath: string, maxLines: number): Promise<string[]> {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      resolve([]);
      return;
    }
    const lines: string[] = [];
    const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
    rl.on("line", (line) => {
      lines.push(line);
      if (lines.length > maxLines) lines.shift();
    });
    rl.on("close", () => resolve(lines));
    rl.on("error", () => resolve(lines));
  });
}

export async function getBacklog(pm2Name: string, maxLinesPerStream = 200): Promise<LogLine[]> {
  const desc = await describeProcess(pm2Name);
  const env = desc?.pm2_env as { pm_out_log_path?: string; pm_err_log_path?: string } | undefined;
  if (!env) return [];

  const [outLines, errLines] = await Promise.all([
    env.pm_out_log_path ? tailFile(env.pm_out_log_path, maxLinesPerStream) : Promise.resolve([]),
    env.pm_err_log_path ? tailFile(env.pm_err_log_path, maxLinesPerStream) : Promise.resolve([]),
  ]);

  return [
    ...outLines.map((text) => ({ stream: "out" as const, text })),
    ...errLines.map((text) => ({ stream: "err" as const, text })),
  ];
}
