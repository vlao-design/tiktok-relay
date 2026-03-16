const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`TikTok relay running on port ${PORT}`);

wss.on('connection', (clientWs) => {
  let tiktokConnection = null;

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'connect' && msg.username) {
        const username = msg.username.replace(/^@/, '');

        if (tiktokConnection) {
          try { tiktokConnection.disconnect(); } catch {}
        }

        tiktokConnection = new WebcastPushConnection(username);

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
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'disconnected' }));
          }
        });

        tiktokConnection.on('error', (err) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
          }
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
```

Then push to GitHub again:
```
git add .
git commit -m "fix package name"
git push
