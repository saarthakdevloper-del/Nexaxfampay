import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut, GoogleAuthProvider, signInWithPopup, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const ok = (o = {}) => ({ ok: true, ...o }), err = e => ({ ok: false, error: typeof e === 'string' ? e : nice(e) });
const nice = e => ({ 'auth/invalid-credential': 'Wrong email or password', 'auth/email-already-in-use': 'This email is already registered', 'auth/weak-password': 'Password must be at least 6 characters', 'auth/user-not-found': 'No account found with this email', 'auth/too-many-requests': 'Too many attempts. Try again later', 'auth/popup-closed-by-user': 'Google sign-in was cancelled', 'auth/network-request-failed': 'Network error. Check your internet' }[e && e.code] || (e && e.message) || 'Something went wrong');
const PREFIX = { fampay: 'FAM_', paytm: 'PAY_', bharatpe: 'BHP_' };
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
const uid = () => auth.currentUser && auth.currentUser.uid;
const T = d => d && d.toDate ? d.toDate().toISOString() : d;

async function ensureProfile(u, provider, name) {
  const r = doc(db, 'users', u.uid), s = await getDoc(r);
  if (!s.exists()) await setDoc(r, { name: name || u.displayName || u.email.split('@')[0], email: u.email, role: 'user', blocked: false, auth_provider: provider, created_at: new Date().toISOString() });
  return (await getDoc(r)).data();
}
async function txns(filter) {
  const s = await getDocs(collection(db, 'users', uid(), 'transactions'));
  const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate()), wk = new Date(day - 6 * 864e5), mo = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = { today: day, week: wk, month: mo }[filter];
  let list = s.docs.map(d => d.data()).sort((a, b) => String(b.payment_time_ist).localeCompare(String(a.payment_time_ist)));
  if (from) list = list.filter(t => new Date(t.payment_time_ist) >= from);
  return list;
}
const sum = l => ({ t: l.reduce((a, t) => a + (+t.amount || 0), 0), c: l.length });

const A = {
  async login({ email, password }) {
    try {
      const u = (await signInWithEmailAndPassword(auth, email, password)).user;
      if (!u.emailVerified) { await sendEmailVerification(u).catch(() => {}); await signOut(auth); return err('Email not verified. We sent a new link to ' + email + '. Open it, then sign in.'); }
      const p = await ensureProfile(u, 'password');
      if (p.blocked) { await signOut(auth); return err('Your account is blocked. Contact support.'); }
      return ok();
    } catch (e) { return err(e); }
  },
  async signup({ name, email, password }) {
    try {
      const u = (await createUserWithEmailAndPassword(auth, email, password)).user;
      await updateProfile(u, { displayName: name }); await ensureProfile(u, 'password', name);
      await sendEmailVerification(u); await signOut(auth);
      return ok({ message: 'Account created. We sent a verification link to ' + email + '. Open it, then sign in.' });
    } catch (e) { return err(e); }
  },
  async forgot_password({ email }) { try { await sendPasswordResetEmail(auth, email); return ok({ message: 'Password reset link sent to ' + email }); } catch (e) { return err(e); } },
  async google_login() {
    try {
      const u = (await signInWithPopup(auth, new GoogleAuthProvider())).user, p = await ensureProfile(u, 'google');
      if (p.blocked) { await signOut(auth); return err('Your account is blocked. Contact support.'); }
      return ok();
    } catch (e) { return err(e); }
  },
  async logout() { await signOut(auth); return ok(); },
  async get_account() { const p = (await getDoc(doc(db, 'users', uid()))).data(); return ok({ user: { name: p.name, email: p.email, auth_provider: p.auth_provider, created_at: p.created_at } }); },
  async update_name({ name }) { if (!name.trim()) return err('Name required'); await updateDoc(doc(db, 'users', uid()), { name: name.trim() }); await updateProfile(auth.currentUser, { displayName: name.trim() }); return ok({ message: 'Name updated' }); },
  async change_password({ current, new: n }) {
    try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, current)); await updatePassword(auth.currentUser, n); return ok({ message: 'Password changed' }); } catch (e) { return err(e); }
  },
  async sub_status() { return ok({ free_mode: true, user: { subscription_status: 'active' } }); },
  async list_apps() { const s = await getDocs(collection(db, 'users', uid(), 'apps')); return ok({ apps: s.docs.map(d => { const x = d.data(); delete x.app_password; return x; }) }); },
  async get_app({ gateway }) { const s = await getDoc(doc(db, 'users', uid(), 'apps', gateway)); if (!s.exists()) return err('App not found'); const x = s.data(); delete x.app_password; return ok({ app: x }); },
  async connect(p) {
    try {
      const g = p.gateway, r = doc(db, 'users', uid(), 'apps', g), old = await getDoc(r);
      const key = old.exists() ? old.data().api_key : PREFIX[g] + rnd(), data = { ...p, api_key: key, status: 'active', updated_at: new Date().toISOString() };
      if (old.exists() && !p.app_password) data.app_password = old.data().app_password || '';
      await setDoc(r, data);
      if (!old.exists()) await setDoc(doc(db, 'apiKeys', key), { uid: uid(), gateway: g });
      return ok({ message: old.exists() ? 'App updated' : 'App connected. Your API key is ready.' });
    } catch (e) { return err(e); }
  },
  async disconnect_app({ gateway }) {
    const r = doc(db, 'users', uid(), 'apps', gateway), s = await getDoc(r);
    if (s.exists()) { await deleteDoc(doc(db, 'apiKeys', s.data().api_key)).catch(() => {}); await deleteDoc(r); }
    return ok({ message: 'Disconnected' });
  },
  async stats() { const l = await txns('all'); return ok({ stats: { today: sum(await txns('today')), month: sum(await txns('month')), total: sum(l) } }); },
  async transactions({ filter }) { const l = await txns(filter || 'all'); return ok({ summary: sum(l), transactions: l.slice(0, 300) }); },
  async get_active_qr() { return err('Subscription is disabled. All features are free.'); },
  async verify_subscription() { return err('Subscription is disabled. All features are free.'); }
};
window.__fbApiResolve(async (action, body) => { try { return A[action] ? await A[action](body || {}) : err('Not supported: ' + action); } catch (e) { return err(e); } });
let first = true;
onAuthStateChanged(auth, async u => {
  if (!first) return; first = false;
  let good = false;
  if (u && (u.emailVerified || u.providerData.some(p => p.providerId === 'google.com'))) { const p = await ensureProfile(u, 'password').catch(() => null); good = !!p && !p.blocked; if (!good) await signOut(auth); }
  window.__fbResolve(good);
});
