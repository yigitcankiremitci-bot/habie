import type { WebSocket } from 'ws';

/**
 * Bağlı cihazların kaydı: device_id -> soket(ler).
 *
 * Tek instance içinde bellekte tutuluyor. Yatay ölçeklenince bu katman
 * Redis pub/sub veya NATS ile değiştirilir — arayüzü aynı kalır,
 * çağıran kod (routes.ts) değişmez.
 */
const sockets = new Map<string, Set<WebSocket>>();

export function attach(deviceId: string, ws: WebSocket) {
  if (!sockets.has(deviceId)) sockets.set(deviceId, new Set());
  sockets.get(deviceId)!.add(ws);
}

export function detach(deviceId: string, ws: WebSocket) {
  const s = sockets.get(deviceId);
  if (!s) return;
  s.delete(ws);
  if (s.size === 0) sockets.delete(deviceId);
}

export function isOnline(deviceId: string) {
  return sockets.has(deviceId);
}

/** Cihaz bağlıysa anında iletir; değilse false döner → Web Push devreye girer. */
export function push(deviceId: string, payload: unknown): boolean {
  const s = sockets.get(deviceId);
  if (!s || s.size === 0) return false;
  const msg = JSON.stringify(payload);
  for (const ws of s) {
    if (ws.readyState === 1) ws.send(msg);
  }
  return true;
}

export const onlineCount = () => sockets.size;
