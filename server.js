const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

console.log(`TikTok relay running on port ${PORT}`);

wss.on('connection', (clientWs) => {
  let tiktokConnection = null;
  console.log('Browser connected to relay');

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log('Received from browser:', msg);

      if (msg.action === 'connect' && msg.username) {
        const username = msg.username.replace(/^@/, '');
        console.log('Connecting to TikTok username:', username);

        if (tiktokConnection) {
          try { tiktokConnection.disconnect(); } catch {}
        }

        tiktokConnection = new WebcastPushConnection(username);

        tiktokConnection.connect()
          .then((state) => {
            console.log('Connected to TikTok:', state);
            clientWs.send(JSON.stringify({ type: 'connected', username }));
          })
          .catch((err) => {
            console.log('TikTok connect error:', err.message);
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
          });

        tiktokConnection.on('chat', (data) => {
          console.log('Chat message:', data.uniqueId, data.comment);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'chat',
              uniqueId: data.uniqueId || 'viewer',
              comment: data.comment || '',
            }));
          }
        });

        tiktokConnection.on('disconnected', () => {
          console.log('TikTok disconnected');
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'disconnected' }));
          }
        });

        tiktokConnection.on('error', (err) => {
          console.log('TikTok error:', err.message);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        });
      }
    } catch(e) {
      console.log('Parse error:', e.message);
    }
  });

  clientWs.on('close', () => {
    console.log('Browser disconnected');
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
    }
  });
});
