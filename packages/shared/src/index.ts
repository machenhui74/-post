export * from "./platforms.js";
export * from "./models.js";
export * from "./protocol.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
