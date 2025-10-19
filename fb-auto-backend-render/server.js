// server.js - Render-ready backend (CommonJS)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit').rateLimit;
const Database = require('better-sqlite3');
const morgan = require('morgan');

const app = express();
app.use(express.json());
app.use(morgan('dev'));

// CORS: allow from any by default; change to your dashboard origin if needed
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
app.use(cors({ origin: ALLOW_ORIGIN }));

const {
  PAGE_ACCESS_TOKEN,
  VERIFY_TOKEN = 'verify_token',
  APP_SECRET = '',
  PORT = 3000,
  GRAPH_VERSION = 'v21.0',
} = process.env;

if (!PAGE_ACCESS_TOKEN) {
  console.error('ERROR: Missing PAGE_ACCESS_TOKEN in environment.');
  process.exit(1);
}

// ---- SQLite (Render ephemeral FS is fine; DB resets on redeploy) ----
const db = new Database('db.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  post_id TEXT,
  comment_id TEXT,
  psid TEXT,
  message TEXT,
  status TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// ---- FB client ----
const FB = axios.create({
  baseURL: `https://graph.facebook.com/${GRAPH_VERSION}`,
  params: { access_token: PAGE_ACCESS_TOKEN },
  timeout: 30000,
});

async function* paginate(url, params = {}) {
  let next = { url, params };
  while (next) {
    const { data } = await FB.get(next.url, { params: next.params });
    if (data?.data?.length) yield data.data;
    next = data?.paging?.next
      ? { url: data.paging.next.replace(`https://graph.facebook.com/${GRAPH_VERSION}`, ''), params: {} }
      : null;
  }
}

async function sendPrivateReply(commentId, message) {
  const { data } = await FB.post(`/${commentId}/private_replies`, { message });
  return data;
}

async function sendInbox(psid, text) {
  const { data } = await FB.post(`/me/messages`, {
    recipient: { id: psid },
    message: { text },
    messaging_type: 'RESPONSE', // valid within 24h window
  });
  return data;
}

function verifySignature(req) {
  if (!APP_SECRET) return true; // skip if not provided
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', APP_SECRET);
  hmac.update(JSON.stringify(req.body), 'utf-8');
  const expected = `sha256=${hmac.digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

// ----- Rate limit your own API -----
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 120 }));

// ----- Health -----
app.get('/', (_req, res) => res.json({ ok: true, service: 'fb-auto-backend', version: '1.0.0' }));

// ----- Webhook (Meta) -----
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(403);
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message && event.sender?.id) {
          // Here you can record thread 24h if needed
          // console.log('Incoming message from PSID:', event.sender.id);
        }
      }
    }
  }
  res.sendStatus(200);
});

// ----- API: list comments of a post -----
app.get('/api/posts/:postId/comments', async (req, res) => {
  const { postId } = req.params;
  try {
    const out = [];
    for await (const chunk of paginate(`/${postId}/comments`, { fields: 'id,from' })) {
      out.push(...chunk);
    }
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

// ----- API: bulk private replies by postId -----
app.post('/api/private-replies', async (req, res) => {
  const { post_id, message } = req.body || {};
  if (!post_id || !message) return res.status(400).json({ ok: false, error: 'post_id & message required' });
  const results = { sent: 0, failed: 0, details: [] };
  try {
    for await (const chunk of paginate(`/${post_id}/comments`, { fields: 'id,from' })) {
      for (const c of chunk) {
        try {
          await sendPrivateReply(c.id, message);
          db.prepare('INSERT INTO logs (type, post_id, comment_id, message, status) VALUES (?,?,?,?,?)')
            .run('private_reply', post_id, c.id, message, 'sent');
          results.sent++;
          results.details.push({ comment_id: c.id, status: 'sent' });
          await new Promise(r => setTimeout(r, 350));
        } catch (e) {
          const err = e?.response?.data ? JSON.stringify(e.response.data) : String(e.message);
          db.prepare('INSERT INTO logs (type, post_id, comment_id, message, status, error) VALUES (?,?,?,?,?,?)')
            .run('private_reply', post_id, c.id, message, 'failed', err);
          results.failed++;
          results.details.push({ comment_id: c.id, status: 'failed', error: err });
        }
      }
    }
    res.json({ ok: true, sent: results.sent, failed: results.failed, details: results.details });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});

// ----- API: logs -----
app.get('/api/logs', (_req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 500').all();
  res.json({ ok: true, data: rows });
});

// (Optional) API: send inbox within 24h window (uncomment to use)
// app.post('/api/send/inbox', async (req, res) => {
//   const { psid, text } = req.body || {};
//   if (!psid || !text) return res.status(400).json({ ok: false, error: 'psid & text required' });
//   try {
//     await sendInbox(psid, text);
//     res.json({ ok: true });
//   } catch (e) {
//     res.status(500).json({ ok: false, error: e?.response?.data || e.message });
//   }
// });

app.listen(PORT, () => {
  console.log(`Backend running on :${PORT}`);
});
