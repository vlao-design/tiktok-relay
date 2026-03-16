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
  let currentUsername = null;
  let sentConnected = false;
  console.log('Browser connected to relay');

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.action === 'ping') {
        clientWs.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (msg.action === 'connect' && msg.username) {
        const username = msg.username.replace(/^@/, '');

        if (currentUsername === username && tiktokConnection) {
          console.log('Already connected to:', username);
          clientWs.send(JSON.stringify({ type: 'connected', username }));
          return;
        }

        currentUsername = username;
        sentConnected = false;
        console.log('Connecting to TikTok username:', username);

        if (tiktokConnection) {
          try { tiktokConnection.disconnect(); } catch {}
          tiktokConnection = null;
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

        tiktokConnection.connect()
          .then(() => {
            console.log('TikTok handshake complete for:', username);
          })
          .catch((err) => {
            if (err && err.message) {
              console.log('TikTok connect error:', err.message);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
              }
            }
          });

        tiktokConnection.on('chat', (data) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          if (!sentConnected) {
            sentConnected = true;
            clientWs.send(JSON.stringify({ type: 'connected', username }));
          }
          clientWs.send(JSON.stringify({
            type: 'chat',
            uniqueId: data.uniqueId || 'viewer',
            comment: data.comment || '',
          }));
        });

        tiktokConnection.on('connected', () => {
          console.log('TikTok connected event for:', username);
          if (!sentConnected && clientWs.readyState === WebSocket.OPEN) {
            sentConnected = true;
            clientWs.send(JSON.stringify({ type: 'connected', username }));
          }
        });

        tiktokConnection.on('disconnected', () => {
          console.log('TikTok disconnected for:', username);
          currentUsername = null;
          sentConnected = false;
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'disconnected' }));
          }
        });

        tiktokConnection.on('error', (err) => {
          if (err && err.message) {
            console.log('TikTok error:', err.message);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
            }
          }
        });
      }
    } catch(e) {
      console.log('Parse error:', e.message);
    }
  });

  clientWs.on('close', () => {
    console.log('Browser disconnected');
    currentUsername = null;
    sentConnected = false;
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
      tiktokConnection = null;
    }
  });
});
