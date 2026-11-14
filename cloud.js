/* =========================================================
   クラウド保存（Firebase：Googleログイン + Firestore）
   - 記録は users/{ログインした人のID}/books/{本のID} に保存
   - 電波がないときは端末に一時保存され、つながったら自動で送られる
   - 別の端末で書きかえると、開いている画面にも自動で反映される
   ========================================================= */
const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

let fb = null;
export let user = null;

export async function init(config, { onUser, onRemoteChange, onError }) {
  const [appM, authM, fsM] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const app = appM.initializeApp(config);
  const auth = authM.getAuth(app);
  let db;
  try {
    db = fsM.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsM.getFirestore(app);
  }
  fb = { authM, fsM, auth, db, onError };

  let unsub = null;
  authM.onAuthStateChanged(auth, (u) => {
    if (unsub) { unsub(); unsub = null; }
    user = u;
    store._reset();
    if (u) unsub = store._listen(u.uid, onRemoteChange);
    onUser(u);
  });
}

export async function signIn() {
  const provider = new fb.authM.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await fb.authM.signInWithPopup(fb.auth, provider);
}

export async function signOut() {
  await fb.authM.signOut(fb.auth);
}

const report = (e) => { console.error(e); fb?.onError?.(e); };

export const store = {
  _cache: new Map(),
  _uid: null,
  ready: Promise.resolve(),

  _reset() { this._cache = new Map(); this._uid = null; this.ready = Promise.resolve(); },
  _col() { return fb.fsM.collection(fb.db, 'users', this._uid, 'books'); },
  _ref(id) { return fb.fsM.doc(fb.db, 'users', this._uid, 'books', id); },

  _listen(uid, onRemoteChange) {
    this._uid = uid;
    let first = true;
    let resolveReady;
    this.ready = new Promise((r) => { resolveReady = r; });
    return fb.fsM.onSnapshot(this._col(), (snap) => {
      const changes = snap.docChanges();
      changes.forEach((ch) => {
        if (ch.type === 'removed') this._cache.delete(ch.doc.id);
        else this._cache.set(ch.doc.id, ch.doc.data());
      });
      if (first) { first = false; resolveReady(); return; }
      // 自分の書きこみ（hasPendingWrites）ではなく、ほかの端末からの変更だけ画面に反映
      if (!snap.metadata.hasPendingWrites && changes.length) onRemoteChange?.();
    }, (err) => { resolveReady(); report(err); });
  },

  async list() { await this.ready; return [...this._cache.values()].map((b) => structuredClone(b)); },
  async get(id) { await this.ready; const b = this._cache.get(id); return b ? structuredClone(b) : null; },

  // 書きこみは待たずに返す（電波がなくても、つながったときに自動で送られる）
  async save(book) {
    this._cache.set(book.id, structuredClone(book));
    fb.fsM.setDoc(this._ref(book.id), book).catch(report);
    return book;
  },
  async remove(id) {
    this._cache.delete(id);
    fb.fsM.deleteDoc(this._ref(id)).catch(report);
  },
  async replaceAll(list) {
    for (let i = 0; i < list.length; i += 400) {
      const batch = fb.fsM.writeBatch(fb.db);
      list.slice(i, i + 400).forEach((b) => { this._cache.set(b.id, structuredClone(b)); batch.set(this._ref(b.id), b); });
      batch.commit().catch(report);
    }
  },
};
