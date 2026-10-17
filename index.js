const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const QRCode = require('qrcode');
admin.initializeApp();
const db = admin.firestore();
const INGEST_SECRET = defineSecret('INGEST_SECRET');

async function owner(req, res) {
  const key = String(req.query.api_key || req.body?.api_key || '').trim();
  if (!key) { res.status(400).json({ status: 'error', message: 'api_key is required' }); return null; }
  const k = await db.doc('apiKeys/' + key).get();
  if (!k.exists) { res.status(401).json({ status: 'error', message: 'Invalid API key' }); return null; }
  const { uid, gateway } = k.data();
  const u = await db.doc('users/' + uid).get();
  if (!u.exists || u.data().blocked) { res.status(403).json({ status: 'error', message: 'Account blocked' }); return null; }
  return { uid, gateway };
}

// GET /api/verify?api_key=...&utr=...   (also accepts orderid=)
exports.verify = onRequest({ cors: true }, async (req, res) => {
  const o = await owner(req, res); if (!o) return;
  const utr = String(req.query.utr || req.query.orderid || '').trim();
  if (!utr) return res.status(400).json({ status: 'error', message: 'utr is required' });
  const t = await db.doc(`users/${o.uid}/transactions/${utr}`).get();
  if (!t.exists) return res.json({ status: 'not_found', utr });
  res.json({ status: 'success', ...t.data() });
});

// GET /api/qr?api_key=...&amount=100
exports.qr = onRequest({ cors: true }, async (req, res) => {
  const o = await owner(req, res); if (!o) return;
  const a = await db.doc(`users/${o.uid}/apps/${o.gateway}`).get();
  if (!a.exists) return res.status(404).json({ status: 'error', message: 'App not connected' });
  const amount = Number(req.query.amount) > 0 ? Number(req.query.amount).toFixed(2) : '';
  const upi = `upi://pay?pa=${encodeURIComponent(a.data().upi_id)}&cu=INR` + (amount ? `&am=${amount}` : '');
  res.json({ status: 'success', upi_url: upi, qr_url: `https://${req.hostname}/api/qr_img?data=${encodeURIComponent(upi)}`, amount: amount || null });
});

// GET /api/qr_img?data=upi://...  -> PNG
exports.qr_img = onRequest(async (req, res) => {
  const d = String(req.query.data || '');
  if (!d.startsWith('upi://pay') || d.length > 400) return res.status(400).send('Bad data');
  res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=3600').send(await QRCode.toBuffer(d, { width: 400, margin: 2 }));
});

// POST /api/ingest  header x-ingest-secret  body {api_key, utr, amount, sender_name, transaction_id, payment_time_ist}
// Call this from whatever detects incoming payments (notification forwarder, mail parser, merchant API poller).
exports.ingest = onRequest({ secrets: [INGEST_SECRET] }, async (req, res) => {
  if (req.method !== 'POST' || req.get('x-ingest-secret') !== INGEST_SECRET.value()) return res.status(403).json({ status: 'error' });
  const o = await owner(req, res); if (!o) return;
  const b = req.body || {}, utr = String(b.utr || '').trim();
  if (!utr || !(Number(b.amount) > 0)) return res.status(400).json({ status: 'error', message: 'utr and amount required' });
  await db.doc(`users/${o.uid}/transactions/${utr}`).set({ utr, amount: Number(b.amount), gateway: o.gateway, sender_name: b.sender_name || 'Unknown', transaction_id: b.transaction_id || '', payment_time_ist: b.payment_time_ist || new Date().toISOString() }, { merge: true });
  res.json({ status: 'success' });
});
