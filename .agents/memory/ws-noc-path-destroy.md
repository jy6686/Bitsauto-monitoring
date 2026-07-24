---
name: WebSocket noServer pattern for shared HTTP server
description: ws v8 library destroys sockets on path mismatch when using { server, path } — use noServer: true to safely share one HTTP server across multiple WebSocket handlers
---

## Rule
Never use `new WebSocketServer({ server: httpServer, path: "/some/path" })` when multiple WebSocket servers share one HTTP server. The ws v8 library calls `socket.destroy()` for non-matching paths, which kills any upgrade connection that arrives before the matching server gets it.

## Why
ws v8.x upgrade listener code: if `path` is set and pathname doesn't match → `socket.destroy()`. All registered servers fire for EVERY upgrade event. The first registered server that doesn't match the path kills the socket — subsequent handlers (including Vite HMR at /vite-hmr) never see it.

## How to apply
Use `noServer: true` for every WebSocket server on a shared HTTP server:
```ts
const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0];
  if (pathname === '/my/path') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  // Do NOT call socket.destroy() for non-matching paths!
});
```
This was the root cause of Vite HMR WebSocket failures — noc-ws, chat-ws, and live-traffic-ws were each destroying the /vite-hmr upgrade socket before Vite could handle it. Fixed in all 3 files.
