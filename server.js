const WebSocket = require('ws');
const http = require('http');
const { WebcastPushConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('TikTok relay is running');
});

const wss = new WebSocket.Server({ server });

console.log(`TikTok relay running on port ${PORT}`);

server.listen(PORT, () => {
  console.log(`HTTP + WS server listening on port ${PORT}`);
});

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

        tiktokConnection = new WebcastPushConnection(username, {
          sessionId: process.env.TIKTOK_SESSION_ID || '',
          enableExtendedGiftInfo: false,
          enableWebsocketUpgrade: true,
          requestPollingIntervalMs: 2000,
          requestHeaders: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
            'Origin': 'https://www.tiktok.com',
          },
        });

        clientWs.send(JSON.stringify({ type: 'connecting', username }));

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
