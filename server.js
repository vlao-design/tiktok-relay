const WebSocket = require('ws');
const { WebcastPushConnection } = require('@tiktoklive/connector');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`TikTok relay running on port ${PORT}`);

wss.on('connection', (clientWs) => {
  let tiktokConnection = null;
  let username = null;

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'connect' && msg.username) {
        username = msg.username.replace(/^@/, '');

        if (tiktokConnection) {
          try { tiktokConnection.disconnect(); } catch {}
        }

        tiktokConnection = new WebcastPushConnection(username, {
          processInitialData: false,
          fetchRoomInfoOnConnect: true,
          enableExtendedGiftInfo: false,
          enableWebsocketUpgrade: true,
          requestPollingIntervalMs: 2000,
          clientParams: {},
          requestHeaders: {},
        });

        tiktokConnection.connect()
          .then(() => {
            clientWs.send(JSON.stringify({ type: 'connected', username }));
          })
          .catch((err) => {
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
          });

        tiktokConnection.on('chat', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'chat',
              uniqueId: data.uniqueId || 'viewer',
              comment: data.comment || '',
            }));
          }
        });

        tiktokConnection.on('disconnected', () => {
          clientWs.send(JSON.stringify({ type: 'disconnected' }));
        });

        tiktokConnection.on('error', (err) => {
          clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
        });
      }
    } catch {}
  });

  clientWs.on('close', () => {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
    }
  });
});