const WebSocket = require('ws');
const http = require('http');
const { WebcastPushConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('TikTok relay is running');
});

const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

wss.on('connection', (clientWs) => {
  let tiktokConnection = null;
  let currentUsername = null;
  let reconnectTimeout = null;
  let lastMessageTime = Date.now();

  // 🧠 anti-spam
  const userCooldown = new Map();
  const messageCache = new Set();

  const SPAM_COOLDOWN = 1500;
  const DUPLICATE_TTL = 5000;

  function isSpam(user, msg) {
    const now = Date.now();

    if (!msg || msg.length < 1) return true;

    // cooldown per user
    if (userCooldown.has(user)) {
      if (now - userCooldown.get(user) < SPAM_COOLDOWN) return true;
    }
    userCooldown.set(user, now);

    // duplicate messages
    const key = user + msg;
    if (messageCache.has(key)) return true;

    messageCache.add(key);
    setTimeout(() => messageCache.delete(key), DUPLICATE_TTL);

    return false;
  }

  function connectTikTok(username, attempt = 0) {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
      tiktokConnection = null;
    }

    console.log(`Connecting to ${username} (attempt ${attempt})`);

    tiktokConnection = new WebcastPushConnection(username, {
      enableWebsocketUpgrade: true,
      requestPollingIntervalMs: 1500,
    });

    tiktokConnection.connect().catch(() => {
      scheduleReconnect(username, attempt);
    });

    tiktokConnection.on('chat', (data) => {
      lastMessageTime = Date.now();

      const user = data.uniqueId || 'viewer';
      const msg = data.comment || '';

      if (isSpam(user, msg)) return;

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'chat',
          uniqueId: user,
          comment: msg
        }));
      }
    });

    tiktokConnection.on('connected', () => {
      console.log('Connected:', username);
      attempt = 0;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'connected', username }));
      }
    });

    tiktokConnection.on('disconnected', () => {
      console.log('Disconnected');
      scheduleReconnect(username, attempt);
    });

    tiktokConnection.on('error', () => {
      console.log('Error');
      scheduleReconnect(username, attempt);
    });

    // 👀 watchdog
    setInterval(() => {
      if (Date.now() - lastMessageTime > 15000) {
        console.log('No messages, reconnecting...');
        scheduleReconnect(username, attempt);
      }
    }, 7000);
  }

  function scheduleReconnect(username, attempt) {
    if (reconnectTimeout) return;

    const delay = Math.min(10000, 2000 + attempt * 2000);

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connectTikTok(username, attempt + 1);
    }, delay);
  }

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.action === 'ping') {
        clientWs.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (msg.action === 'connect' && msg.username) {
        const username = msg.username.replace(/^@/, '');
        currentUsername = username;
        connectTikTok(username);
      }
    } catch {}
  });

  clientWs.on('close', () => {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
    }
  });
});
