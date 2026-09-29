import { DurableObject } from 'cloudflare:workers';
import roomService from '../room-service.cjs';

// No stored accounts or results: a room exists only while players are connected.
export class RaceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.service = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status: 426});
    if (!this.service) this.service = roomService.createRoomService({code: url.searchParams.get('room'), maxRooms: 1});
    if (this.service.clients.size >= 8) return new Response('Room connection limit reached', {status: 429});
    const [client, server] = Object.values(new WebSocketPair());
    // Standard WebSockets keep this object alive during a temporary game session.
    // All timers stop after the final disconnect; no always-on server is required.
    server.accept();
    const socket = {
      get readyState() { return server.readyState; },
      get bufferedAmount() { return server.bufferedAmount || 0; },
      canCreate: url.searchParams.get('create') === '1',
      send(data) { try { server.send(data); } catch { server.close(1011, 'Connection lost'); } },
      close(code, reason) { server.close(code, reason); },
      terminate() { server.close(1000, 'Connection ended'); },
      on(type, callback) { server.addEventListener(type, event => callback(type === 'message' ? event.data : event)); }
    };
    this.service.attach(socket);
    return new Response(null, {status: 101, webSocket: client});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ok: true, app: 'aqua-rush-gp', platform: 'cloudflare'});
    if (url.pathname !== '/socket') return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status: 426});
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return new Response('Origin not allowed', {status: 403});
    let code = url.searchParams.get('room');
    if (url.searchParams.get('create') === '1') {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      code = Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
    }
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code || '')) return new Response('Invalid room code', {status: 400});
    url.searchParams.set('room', code);
    return env.ROOMS.getByName(code).fetch(new Request(url, request));
  }
};
