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
  let watchdogInterval = null;   // ← single watchdog, cleared on each reconnect
  let lastMessageTime = Date.now();
  let isReconnecting = false;    // ← replaces the racy reconnectTimeout guard

  // 🧠 anti-spam
  const userCooldown = new Map();
  const messageCache = new Set();
  const SPAM_COOLDOWN = 1500;
  const DUPLICATE_TTL = 5000;

  function isSpam(user, msg) {
    const now = Date.now();
    if (!msg || msg.length < 1) return true;
    if (userCooldown.has(user) && now - userCooldown.get(user) < SPAM_COOLDOWN) return true;
    userCooldown.set(user, now);
    const key = user + msg;
    if (messageCache.has(key)) return true;
    messageCache.add(key);
    setTimeout(() => messageCache.delete(key), DUPLICATE_TTL);
    return false;
  }

  function startWatchdog(username) {
    // ← clear any existing watchdog before starting a new one
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
    watchdogInterval = setInterval(() => {
      if (Date.now() - lastMessageTime > 15000) {
        console.log('No messages, reconnecting...');
        scheduleReconnect(username, 0);
      }
    }, 7000);
  }

  function connectTikTok(username, attempt = 0) {
    // tear down previous connection cleanly
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
      tiktokConnection = null;
    }

    console.log(`Connecting to ${username} (attempt ${attempt})`);
    lastMessageTime = Date.now(); // reset so watchdog doesn't fire immediately

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
      const msg  = data.comment  || '';
      if (isSpam(user, msg)) return;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'chat', uniqueId: user, comment: msg }));
      }
    });

    tiktokConnection.on('connected', () => {
      console.log('Connected:', username);
      isReconnecting = false;
      lastMessageTime = Date.now();
      startWatchdog(username); // ← start ONE watchdog after confirmed connect
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
  }

  function scheduleReconnect(username, attempt) {
    if (isReconnecting) return; // ← single flag instead of checking reconnectTimeout
    isReconnecting = true;

    // stop watchdog while waiting to reconnect
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }

    const delay = Math.min(10000, 2000 + attempt * 2000);
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      isReconnecting = false;
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
        // reset reconnect state for a fresh connect request
        isReconnecting = false;
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        connectTikTok(username, 0);
      }
    } catch {}
  });

  clientWs.on('close', () => {
    if (watchdogInterval) clearInterval(watchdogInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch {}
    }
  });
});
