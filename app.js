'use strict';

/* =========================================================
   読書アウトプットノート
   - 段階1：データは端末（localStorage）に保存
   - 段階2：firebase-config.js を設定すると、Googleログイン＋クラウド保存（スマホとPCで同期）
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (s) => s ? s.replace(/-/g, '/') : '';

/* ---------- データ保存 ----------
   LocalStore：この端末だけに保存
   Cloud.store：Firebase に保存（firebase-config.js を設定したとき） */
const STORAGE_KEY = 'book-output-note:v1';
const LocalStore = {
  _read() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } },
  _write(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); },
  async list() { return this._read(); },
  async get(id) { return this._read().find((b) => b.id === id) || null; },
  async save(book) {
    const list = this._read();
    const i = list.findIndex((b) => b.id === book.id);
    if (i >= 0) list[i] = book; else list.push(book);
    this._write(list);
    return book;
  },
  async remove(id) { this._write(this._read().filter((b) => b.id !== id)); },
  async replaceAll(list) { this._write(list); },
};
let Store = LocalStore;
let Cloud = null; // クラウド保存を使うときに読みこむ

const pref = {
  get(k, d) { try { const v = localStorage.getItem('bon:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bon:' + k, JSON.stringify(v)); } catch {} },
};

function newBook() {
  return {
    id: uid(), title: '', author: '', publisher: '', isbn: '', cover: '',
    readDate: today(), rating: 0, tags: [],
    oneLine: '', summary: '',
    chapters: [{ title: '', body: '' }, { title: '', body: '' }, { title: '', body: '' }],
    quotes: [{ text: '' }, { text: '' }, { text: '' }],
    actions: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/* ---------- 小さな部品 ---------- */
const ICON = {
  search: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-6C21.4 14.1 22 12.6 22 11c0-4.4-4.5-8-10-8z"/></svg>',
};
const PH_COLORS = ['#3b5b7e', '#7a4b3a', '#4f6b4a', '#6d5a86', '#8a6a2f', '#3f6f73', '#8b4a5c'];
function phColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PH_COLORS[h % PH_COLORS.length]; }
function placeholderHTML(title) {
  return `<div class="cover-ph" style="background:${phColor(title || '?')}"><span>${esc(title || 'No Title')}</span></div>`;
}
function coverHTML(b) {
  let inner = placeholderHTML(b.title);
  if (b.cover) {
    // 表紙が見つからなかったときは、別の無料サービスの表紙を順番に試す
    const alts = b.isbn && !b.cover.startsWith('data:')
      ? [hanmotoCover(b.isbn), ndlThumb(b.isbn)].filter((u) => u !== b.cover) : [];
    inner = `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-title="${esc(b.title)}" data-alt="${esc(alts.join('|'))}" onerror="coverFail(this)" onload="coverLoad(this)">`;
  }
  return `<div class="cover">${inner}</div>`;
}
// 「画像なし」の小さな代わり画像が返ってきたときも、見つからなかった扱いにする
window.coverLoad = (img) => { if (img.naturalWidth < 60) coverFail(img); };
window.coverFail = (img) => {
  const alts = (img.dataset.alt || '').split('|').filter(Boolean);
  if (alts.length) { img.dataset.alt = alts.slice(1).join('|'); img.src = alts[0]; return; }
  img.outerHTML = placeholderHTML(img.dataset.title);
};
function stars(n, cls = 'stars-s') {
  if (!n) return '';
  return `<span class="${cls}" aria-label="評価${n}">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
}
function actionProgress(b) {
  const acts = (b.actions || []).filter((a) => a.text.trim());
  return { total: acts.length, done: acts.filter((a) => a.done).length };
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function autoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
function growAll() { document.querySelectorAll('textarea.ruled').forEach(autoGrow); }

/* ---------- モーダル ---------- */
let onModalClose = null;
function openModal(html, onClose) {
  const m = $('#modal');
  $('.modal-panel', m).innerHTML = html;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  onModalClose = onClose || null;
}
async function closeModal() {
  const m = $('#modal');
  if (m.hidden) return;
  m.hidden = true;
  document.body.style.overflow = '';
  const f = onModalClose; onModalClose = null;
  if (f) await f();
}

/* ---------- 確認ダイアログ（ブラウザ標準の confirm は LINE内ブラウザなどで出ないことがあるため自前で用意） ---------- */
function askConfirm(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; resolve(v); };
    openModal(`
      <h3>確認</h3>
      <p class="confirm-msg">${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn" data-confirm="0">キャンセル</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm="1">${esc(okLabel)}</button>
      </div>`, () => done(false));
    document.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
      const v = b.dataset.confirm === '1';
      done(v);
      await closeModal();
    }));
  });
}

/* ---------- 画面の切り替え ---------- */
const app = $('#app');
let editing = null;      // 編集中の状態 { draft, dirty, isNew }
let currentHash = location.hash;
let suppressRoute = false;

window.addEventListener('hashchange', () => {
  if (suppressRoute) { suppressRoute = false; return; }
  if (editing?.dirty) {
    const target = location.hash;
    suppressRoute = true; location.hash = currentHash; // いったん元の画面に戻して確認する
    askConfirm('保存していない変更があります。破棄して移動しますか？', '破棄して移動', true).then((ok) => {
      if (!ok) return;
      editing.dirty = false;
      location.hash = target;
    });
    return;
  }
  route();
});
window.addEventListener('beforeunload', (e) => { if (editing?.dirty) { e.preventDefault(); e.returnValue = ''; } });

// soft = true のときは、スクロール位置や開いている画面をそのままにして描き直す（別の端末からの変更の反映用）
async function route(soft = false) {
  currentHash = location.hash;
  if (Cloud && !Cloud.user) return renderLogin();
  if (!soft) { closeModal(); window.scrollTo(0, 0); }
  const [, view, id] = (location.hash.slice(1) || '/').split('/');
  const y = window.scrollY;
  editing = null;
  if (view === 'book' && id) await renderDetail(id);
  else if (view === 'edit' && id) await renderEdit(id);
  else if (view === 'new') await renderEdit(null);
  else await renderList();
  if (soft) window.scrollTo(0, y);
}

/* =========================================================
   本棚（一覧・検索）
   ========================================================= */
const listState = { q: '', tag: '', sort: pref.get('sort', 'readDate') };

async function renderList() {
  const books = await Store.list();
  if (!books.length) {
    app.innerHTML = `
      <div class="empty"><div class="sheet">
        <h2>まだ本がありません</h2>
        <p>読んだ本を1冊、ノートに書き出してみましょう。<br>バーコードを読み取ると表紙や著者が自動で入ります。</p>
        <a class="btn primary" href="#/new">＋ 最初の1冊を記録する</a>
      </div></div>`;
    return;
  }
  const tags = [...new Set(books.flatMap((b) => b.tags || []))].sort((a, b) => a.localeCompare(b, 'ja'));
  if (listState.tag && !tags.includes(listState.tag)) listState.tag = '';
  app.innerHTML = `
    <div class="list-head">
      <label class="search">${ICON.search}<input id="q" type="search" placeholder="タイトル・著者・タグ・内容で検索" value="${esc(listState.q)}" aria-label="検索"></label>
      ${tags.length ? `<div class="tag-filter">${['', ...tags].map((t) => `<button class="chip ${t === listState.tag ? 'on' : ''}" data-tag="${esc(t)}">${t ? '#' + esc(t) : 'すべて'}</button>`).join('')}</div>` : ''}
      <div class="list-tools">
        <span class="count" id="count"></span>
        <select id="sort" aria-label="並び順">
          <option value="readDate">読了日が新しい順</option>
          <option value="readDateAsc">読了日が古い順</option>
          <option value="updated">更新が新しい順</option>
          <option value="rating">評価が高い順</option>
          <option value="title">タイトル順</option>
        </select>
      </div>
    </div>
    <div id="shelf" class="shelf"></div>
    <a class="fab" href="#/new">＋ 本を記録する</a>`;
  $('#sort').value = listState.sort;

  const draw = () => {
    const q = listState.q.trim().toLowerCase();
    let list = books.filter((b) => {
      if (listState.tag && !(b.tags || []).includes(listState.tag)) return false;
      if (!q) return true;
      const hay = [b.title, b.author, b.publisher, b.oneLine, b.summary, ...(b.tags || []),
        ...(b.chapters || []).flatMap((c) => [c.title, c.body]),
        ...(b.quotes || []).map((x) => x.text), ...(b.actions || []).map((x) => x.text)].join('\n').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    const s = listState.sort;
    list.sort((a, b) => {
      if (s === 'title') return a.title.localeCompare(b.title, 'ja');
      if (s === 'rating') return (b.rating || 0) - (a.rating || 0) || (b.readDate || '').localeCompare(a.readDate || '');
      if (s === 'updated') return b.updatedAt - a.updatedAt;
      const r = (b.readDate || '').localeCompare(a.readDate || '') || b.createdAt - a.createdAt;
      return s === 'readDateAsc' ? -r : r;
    });
    $('#count').textContent = `${list.length}冊${list.length !== books.length ? ` / 全${books.length}冊` : ''}`;
    $('#shelf').innerHTML = list.length ? list.map((b) => {
      const p = actionProgress(b);
      return `<a class="card" href="#/book/${b.id}">
        ${coverHTML(b)}
        <div class="card-body">
          <h3>${esc(b.title)}</h3>
          ${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}
          ${b.oneLine ? `<p class="oneline">${esc(b.oneLine)}</p>` : ''}
          <div class="card-meta">
            ${stars(b.rating)}
            ${p.total ? `<span class="prog-pill ${p.done === p.total ? 'done' : ''}">行動 ${p.done}/${p.total}</span>` : ''}
            ${b.readDate ? `<span>${fmtDate(b.readDate)}</span>` : ''}
          </div>
        </div></a>`;
    }).join('') : `<p class="blank-note">見つかりませんでした</p>`;
  };

  $('#q').addEventListener('input', (e) => { listState.q = e.target.value; draw(); });
  $('#sort').addEventListener('change', (e) => { listState.sort = e.target.value; pref.set('sort', listState.sort); draw(); });
  app.querySelectorAll('[data-tag]').forEach((btn) => btn.addEventListener('click', () => {
    listState.tag = btn.dataset.tag;
    app.querySelectorAll('[data-tag]').forEach((x) => x.classList.toggle('on', x === btn));
    draw();
  }));
  draw();
}

/* =========================================================
   詳細（読む画面）
   ========================================================= */
let viewing = null;

async function renderDetail(id) {
  const b = await Store.get(id);
  if (!b) { location.hash = '#/'; return; }
  viewing = b;
  const chapters = (b.chapters || []).filter((c) => c.body.trim());
  const quotes = (b.quotes || []).filter((q) => q.text.trim());
  const actions = (b.actions || []).filter((a) => a.text.trim());
  const hasBody = b.oneLine || b.summary || chapters.length || quotes.length || actions.length;
  const meta = [b.publisher, b.readDate && `読了 ${fmtDate(b.readDate)}`].filter(Boolean).join(' ・ ');

  app.innerHTML = `
    <div class="toolbar">
      <a class="btn-text" href="#/">← 本棚</a><div class="spacer"></div>
      <a class="btn small" href="#/edit/${b.id}">編集する</a>
    </div>
    <article class="sheet">
      <header class="book-head">
        ${coverHTML(b)}
        <div>
          <h1>${esc(b.title)}</h1>
          ${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}
          ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
          ${b.rating ? `<div>${stars(b.rating, 'stars-l')}</div>` : ''}
          ${b.tags?.length ? `<div class="tags">${b.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </header>

      ${b.oneLine ? `<h2 class="sec-title">ひとことで言うと</h2><p><span class="oneline-lg">${esc(b.oneLine)}</span></p>` : ''}
      ${b.summary ? `<h2 class="sec-title">簡単な紹介</h2><p class="prose">${esc(b.summary)}</p>` : ''}
      ${chapters.length ? `<h2 class="sec-title">章ごとのまとめ<button class="sec-link" data-act="toggle-all" hidden>すべて開く</button></h2>
        ${b.chapters.map((c, i) => c.body.trim() ? `
          <section class="chapter">
            <div class="chapter-head">
              <h3>${esc(c.title || '（無題）')}</h3>
              <button class="mini-share" data-act="share-ch" data-i="${i}" aria-label="${esc(c.title)}だけをLINEで送る">${ICON.line}この章を送る</button>
            </div>
            <div class="clamp"><p class="prose">${esc(c.body)}</p></div>
            <button class="more" data-act="more" data-len="${[...c.body].length}" hidden></button>
          </section>` : '').join('')}` : ''}
      ${quotes.length ? `<h2 class="sec-title">心に残った一文</h2>${quotes.map((q) => `<blockquote class="quote">${esc(q.text)}</blockquote>`).join('')}` : ''}
      ${actions.length ? `<h2 class="sec-title">すぐに行動に移すこと</h2>
        <ul class="checklist">${actions.map((a, i) => `<li><label><input type="checkbox" data-done="${i}" ${a.done ? 'checked' : ''}><span class="${a.done ? 'done-text' : ''}">${esc(a.text)}</span></label></li>`).join('')}</ul>
        <div class="progress"><div class="progress-bar"><span id="progBar"></span></div><span id="progText"></span></div>` : ''}
      ${hasBody ? '' : `<p class="blank-note">まだ中身が書かれていません。「編集する」から書き足しましょう。</p>`}
    </article>
    <div class="detail-actions">
      <div class="row"><button class="btn line" data-act="share">${ICON.line}LINEで送る</button></div>
      <button class="btn-danger" data-act="delete">この記録を削除する</button>
    </div>`;

  setupClamps();

  const updateProg = () => {
    const p = actionProgress(b);
    const bar = $('#progBar'); if (!bar) return;
    bar.style.width = p.total ? (p.done / p.total * 100) + '%' : '0';
    $('#progText').textContent = p.done === p.total ? `すべて実行！ ${p.done}/${p.total}` : `${p.done}/${p.total} 実行済み`;
  };
  updateProg();
  app.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', async () => {
    actions[+cb.dataset.done].done = cb.checked;
    cb.nextElementSibling.classList.toggle('done-text', cb.checked);
    b.updatedAt = Date.now();
    await Store.save(b);
    updateProg();
    if (cb.checked) toast('ナイス！ 1つ行動できました');
  }));
}

/* 章のまとめは最初の数行だけ見せて、残りは「続きを読む」で開く */
function moreLabel(btn, open) {
  btn.textContent = open ? '▲ 閉じる' : `▼ 続きを読む（全${Number(btn.dataset.len).toLocaleString()}字）`;
}
function setupClamps() {
  let any = false;
  app.querySelectorAll('.chapter').forEach((sec) => {
    const clamp = $('.clamp', sec), btn = $('.more', sec);
    const long = clamp.scrollHeight > clamp.clientHeight + 4;
    clamp.classList.toggle('fade', long);
    btn.hidden = !long;
    if (long) { any = true; moreLabel(btn, false); }
  });
  const all = $('[data-act="toggle-all"]', app);
  if (all) all.hidden = !any;
}
function toggleChapter(sec, open) {
  sec.classList.toggle('open', open);
  const btn = $('.more', sec);
  if (!btn.hidden) moreLabel(btn, open);
}

/* =========================================================
   編集（書く画面）
   ========================================================= */
async function renderEdit(id) {
  let book;
  if (id) {
    book = await Store.get(id);
    if (!book) { location.hash = '#/'; return; }
    book = structuredClone(book);
  } else {
    book = newBook();
  }
  while (book.quotes.length < 3) book.quotes.push({ text: '' });
  while (book.actions.length < 3) book.actions.push({ text: '', done: false });
  if (!book.chapters.length) book.chapters = newBook().chapters;
  book._tags = (book.tags || []).join(' ');
  editing = { draft: book, dirty: false, isNew: !id };

  app.innerHTML = `
    <div class="toolbar">
      <button class="btn-text" data-act="cancel">← 戻る</button>
      <span class="ttl">${id ? '記録を編集' : '新しい本を記録'}</span>
      <span style="width:52px"></span>
    </div>
    <div class="sheet">
      <h2 class="sec-title"><span class="num">01</span>基本情報</h2>
      <div class="lookup">
        <span class="lookup-label">本の情報を自動で入れる</span>
        <div class="row"><button class="btn scan" data-act="scan">バーコードを読み取る</button></div>
        <div class="row">
          <input id="lookupQ" type="search" placeholder="タイトル または ISBN" enterkeyhint="search" aria-label="本を検索">
          <button class="btn small" data-act="lookup">検索</button>
        </div>
        <div id="results" class="results"></div>
      </div>
      <div id="basic"></div>

      <h2 class="sec-title"><span class="num">02</span>ひとこと紹介</h2>
      <p class="sec-hint">「この本は〇〇な本」と一言で。人に紹介するときの最初の一文です。</p>
      <textarea class="ruled one" rows="1" maxlength="80" data-path="oneLine" placeholder="例：がんばらずに続く習慣を、小さな工夫で作れる本">${esc(book.oneLine)}</textarea>
      <div class="counter" id="oneLineCount"></div>

      <h2 class="sec-title"><span class="num">03</span>簡単な紹介</h2>
      <p class="sec-hint">全体としてどんな内容か、誰におすすめかを数行で。</p>
      <textarea class="ruled" data-path="summary" placeholder="どんな人に向けて、何が書かれている本？">${esc(book.summary)}</textarea>

      <h2 class="sec-title"><span class="num">04</span>章ごとのまとめ</h2>
      <p class="sec-hint">章ごとに、どんなことが書かれていたかを詳しく。見出し（序章、第1章、第1話、Part 1 など）は本に合わせて自由に入力してください。たくさん書いても、本の画面では最初の数行だけ表示されます。</p>
      <div id="list-chapters"></div>
      <button class="add-btn" data-act="add" data-list="chapters">＋ 区切りを追加</button>

      <h2 class="sec-title"><span class="num">05</span>心に残った一文</h2>
      <div id="list-quotes"></div>
      <button class="add-btn" data-act="add" data-list="quotes">＋ 一文を追加</button>

      <h2 class="sec-title"><span class="num">06</span>すぐに行動に移すこと</h2>
      <p class="sec-hint">読んで終わりにしないために。小さく、今日からできることを。</p>
      <div id="list-actions"></div>
      <button class="add-btn" data-act="add" data-list="actions">＋ 行動を追加</button>
    </div>
    <div class="save-bar"><div class="inner">
      <button class="btn" data-act="cancel">キャンセル</button>
      <button class="btn primary" data-act="save">保存する</button>
    </div></div>`;

  renderBasic();
  ['chapters', 'quotes', 'actions'].forEach(renderItems);
  updateCounter();
  growAll();
  $('#lookupQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doLookup(); } });
}

function renderBasic() {
  const d = editing.draft;
  $('#basic').innerHTML = `
    <div class="basic">
      <div class="cover-edit">
        ${coverHTML(d)}
        <label class="mini" style="text-align:center">写真を選ぶ<input type="file" accept="image/*" data-act="cover-file" hidden></label>
        ${d.cover ? `<button class="mini" data-act="cover-clear">表紙を外す</button>` : ''}
      </div>
      <div class="fields">
        <label class="field"><span>タイトル（必須）</span><input data-path="title" value="${esc(d.title)}" placeholder="本のタイトル"></label>
        <label class="field"><span>著者</span><input data-path="author" value="${esc(d.author)}" placeholder="著者名"></label>
        <label class="field"><span>出版社</span><input data-path="publisher" value="${esc(d.publisher)}"></label>
        <div class="field-row">
          <label class="field"><span>読了日</span><input type="date" data-path="readDate" value="${esc(d.readDate)}"></label>
          <label class="field"><span>ISBN</span><input data-path="isbn" value="${esc(d.isbn)}" inputmode="numeric"></label>
        </div>
        <div class="field"><span>評価</span>
          <div class="rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-act="rate" data-v="${n}" class="${n <= d.rating ? 'on' : ''}" aria-label="評価${n}">★</button>`).join('')}</div>
        </div>
        <label class="field"><span>タグ（スペース区切り）</span><input data-path="_tags" value="${esc(d._tags)}" placeholder="例：ビジネス 習慣"></label>
      </div>
    </div>`;
}

function renderItems(name) {
  const d = editing.draft;
  const box = $('#list-' + name);
  const rm = (i, label) => `<button class="icon-btn" data-act="remove" data-list="${name}" data-i="${i}" aria-label="${label}を削除">${ICON.close}</button>`;
  if (name === 'chapters') {
    box.innerHTML = d.chapters.map((c, i) => `
      <div class="chapter-item">
        <div class="item"><input class="line-input grow" data-path="chapters.${i}.title" value="${esc(c.title)}" placeholder="見出し（例：序章、第1章、第1話）">${rm(i, 'この章')}</div>
        <textarea class="ruled long" data-path="chapters.${i}.body" placeholder="この章にはどんなことが書かれていた？ 気づいたこと、具体例、自分の考えなど、いくらでも書けます">${esc(c.body)}</textarea>
        <div class="counter" data-count="${i}">${[...c.body].length.toLocaleString()}字</div>
      </div>`).join('');
  } else if (name === 'quotes') {
    box.innerHTML = d.quotes.map((q, i) => `
      <div class="item quote-item"><span class="qmark">“</span>
        <textarea class="ruled one grow" rows="1" data-path="quotes.${i}.text" placeholder="心に残った一文 ${i + 1}">${esc(q.text)}</textarea>${rm(i, 'この一文')}
      </div>`).join('');
  } else {
    box.innerHTML = d.actions.map((a, i) => `
      <div class="item action-item">
        <input type="checkbox" data-path="actions.${i}.done" ${a.done ? 'checked' : ''} aria-label="実行済み">
        <input class="line-input grow" data-path="actions.${i}.text" value="${esc(a.text)}" placeholder="${i === 0 ? '例：毎朝5分、今日やることを書き出す' : `行動 ${i + 1}`}">${rm(i, 'この行動')}
      </div>`).join('');
  }
  box.querySelectorAll('textarea.ruled').forEach(autoGrow);
}

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks.at(-1)] = val;
}

function updateCounter() {
  const el = $('#oneLineCount'); if (!el) return;
  const n = [...editing.draft.oneLine].length;
  el.textContent = `${n} / 80字`;
}

function addItem(name) {
  const d = editing.draft;
  if (name === 'chapters') d.chapters.push({ title: '', body: '' });
  if (name === 'quotes') d.quotes.push({ text: '' });
  if (name === 'actions') d.actions.push({ text: '', done: false });
  editing.dirty = true;
  renderItems(name);
  const box = $('#list-' + name);
  const last = box.lastElementChild;
  const target = last.querySelector('textarea, input:not([type=checkbox])');
  target?.focus();
}

async function removeItem(name, i) {
  const d = editing.draft;
  const it = d[name][i];
  const hasText = name === 'chapters' ? (it.title.trim() || it.body.trim()) : it.text.trim();
  if (hasText && !(await askConfirm('この項目を削除しますか？', '削除する', true))) return;
  d[name].splice(i, 1);
  editing.dirty = true;
  renderItems(name);
}

function parseTags(s) {
  return [...new Set(String(s || '').split(/[\s,、，#＃]+/).map((t) => t.trim()).filter(Boolean))];
}

async function saveDraft() {
  const d = editing.draft;
  if (!d.title.trim()) {
    toast('タイトルを入力してください');
    const t = $('[data-path="title"]'); t.scrollIntoView({ block: 'center' }); t.focus();
    return;
  }
  const { _tags, ...rest } = d;
  const book = {
    ...rest,
    title: d.title.trim(), author: d.author.trim(), publisher: d.publisher.trim(), isbn: d.isbn.trim(),
    tags: parseTags(_tags),
    chapters: d.chapters.filter((c) => c.title.trim() || c.body.trim()),
    quotes: d.quotes.filter((q) => q.text.trim()),
    actions: d.actions.filter((a) => a.text.trim()),
    updatedAt: Date.now(),
  };
  try { await Store.save(book); }
  catch { toast('保存できませんでした（端末の保存容量が足りない可能性があります）'); return; }
  editing.dirty = false;
  toast('保存しました');
  location.hash = '#/book/' + book.id;
}

/* ---------- 表紙写真の読み込み（小さく縮めて保存） ---------- */
function imageToDataURL(file, max = 360) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });
}

/* =========================================================
   本の情報検索（すべて無料・登録不要のサービス）
   openBD（日本の本に強い）→ Google Books（予備・タイトル検索）
   表紙が無いときは国立国会図書館のサムネイル
   ========================================================= */
function normIsbn(s) {
  let d = String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (d.length === 10) {
    const core = '978' + d.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 ? 3 : 1);
    d = core + ((10 - (sum % 10)) % 10);
  }
  return /^97[89]\d{10}$/.test(d) ? d : null;
}
const ndlThumb = (isbn) => `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg`;
const hanmotoCover = (isbn) => `https://img.hanmoto.com/bd/img/${isbn}.jpg`; // 版元ドットコム（書影は利用自由）
function cleanAuthor(a) {
  return String(a || '').replace(/／[^\s　]*/g, '').split(/[\s　]+/).map((p) => cleanCreator(p)).filter(Boolean).join('、');
}

async function openbd(isbns) {
  if (!isbns.length) return [];
  try {
    const r = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbns.join(',')}`);
    if (!r.ok) return [];
    const j = await r.json();
    return j.map((x) => x?.summary?.title ? {
      title: x.summary.title, author: cleanAuthor(x.summary.author), publisher: x.summary.publisher || '',
      isbn: x.summary.isbn, cover: x.summary.cover || '',
    } : null);
  } catch { return []; }
}

async function googleBooks(q) {
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`);
  if (!r.ok) throw new Error('google');
  const j = await r.json();
  return (j.items || []).map((it) => {
    const v = it.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    const isbn = (ids.find((x) => x.type === 'ISBN_13') || {}).identifier || normIsbn((ids.find((x) => x.type === 'ISBN_10') || {}).identifier) || '';
    return {
      title: [v.title, v.subtitle].filter(Boolean).join(' '),
      author: (v.authors || []).join('、'), publisher: v.publisher || '', isbn,
      cover: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:'),
    };
  }).filter((x) => x.title);
}

/* 国立国会図書館サーチ（無料・登録不要。日本の本がほぼすべて載っている） */
function cleanCreator(s) {
  const parts = String(s || '').split(/\s*,\s*/).filter((p) => p && !/^\d{3,4}-?(\d{3,4})?$/.test(p));
  const cjk = parts.every((p) => /[　-鿿＀-￯]/.test(p));
  return parts.join(cjk ? '' : ' ');
}
async function ndlSearch(params, cnt = 5) {
  const r = await fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?cnt=${cnt}&mediatype=books&${params}`);
  if (!r.ok) throw new Error('ndl');
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const seen = new Set();
  const out = [];
  for (const it of xml.getElementsByTagName('item')) {
    const txt = (tag) => [...it.getElementsByTagName(tag)].map((e) => e.textContent.trim()).filter(Boolean);
    const isbn = txt('dc:identifier').map(normIsbn).find(Boolean) || '';
    const fullTitle = txt('dc:title')[0] || txt('title')[0] || '';
    if (!fullTitle) continue;
    const key = isbn || fullTitle;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: fullTitle.split(/\s+:\s+/)[0],
      fullTitle,
      author: [...new Set(txt('dc:creator').map(cleanCreator))].join('、'),
      publisher: txt('dc:publisher')[0] || '',
      isbn,
      cover: isbn ? hanmotoCover(isbn) : '',
      issued: txt('dcterms:issued')[0] || txt('dc:date')[0] || '',
    });
  }
  return out;
}

// 入力した言葉に近いタイトルほど上に並べる
function rankResults(items, q) {
  const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const nq = norm(q);
  const score = (x) => {
    const t = norm(x.title), f = norm(x.fullTitle || x.title);
    let s = 0;
    if (t === nq) s += 100;
    else if (t.startsWith(nq)) s += 60;
    else if (t.includes(nq)) s += 40;
    else if (f.includes(nq)) s += 10;
    if (x.isbn) s += 5;
    if (String(x.isbn).startsWith('9784')) s += 8; // 日本の本を優先
    s -= Math.min(t.length, 40) * 0.3; // 短い（シリーズ名などが付かない）タイトルを優先
    return s;
  };
  return items
    .map((x) => ({ x, s: score(x) }))
    .sort((a, b) => b.s - a.s || String(b.x.issued).localeCompare(String(a.x.issued)))
    .map((o) => o.x);
}

async function findByIsbn(isbn) {
  let info = null;
  try { info = (await ndlSearch('isbn=' + isbn))[0] || null; } catch {}
  const [ob] = await openbd([isbn]);
  if (!info && ob) info = { ...ob, title: ob.title.split(/\s+:\s+/)[0] };
  if (!info) { try { info = (await googleBooks('isbn:' + isbn))[0] || null; } catch {} }
  if (info) { info.isbn = isbn; info.cover = ob?.cover || hanmotoCover(isbn); }
  return info;
}

async function searchByTitle(q) {
  let items = [];
  try { items = await ndlSearch('title=' + encodeURIComponent(q), 40); } catch {}
  if (!items.length) { try { items = await googleBooks(q); } catch {} }
  // 日本の本（ISBNが978-4）が見つかったら、海外の翻訳版は外す
  if (items.some((x) => x.isbn.startsWith('9784'))) items = items.filter((x) => !x.isbn || x.isbn.startsWith('9784'));
  items = rankResults(items, q).slice(0, 12);
  // openBDで表紙・出版社を補う（まとめて1回で問い合わせ）
  const isbns = items.map((x) => x.isbn).filter(Boolean);
  const ob = await openbd(isbns);
  const byIsbn = {}; ob.forEach((x) => { if (x) byIsbn[x.isbn] = x; });
  return items.map((x) => {
    const o = byIsbn[x.isbn];
    return { ...x, cover: o?.cover || x.cover || (x.isbn ? hanmotoCover(x.isbn) : ''), publisher: x.publisher || o?.publisher || '' };
  });
}

let lastResults = [];
async function doLookup() {
  const q = $('#lookupQ').value.trim();
  const box = $('#results');
  if (!q) { toast('タイトルかISBNを入れてください'); return; }
  box.innerHTML = '<div class="loading">検索しています…</div>';
  try {
    const isbn = normIsbn(q);
    if (isbn) {
      const info = await findByIsbn(isbn);
      if (!info) { box.innerHTML = '<div class="loading">見つかりませんでした。少し時間をおいて再検索するか、手入力してください。</div>'; return; }
      applyInfo(info); box.innerHTML = '';
      return;
    }
    lastResults = await searchByTitle(q);
    box.innerHTML = lastResults.length
      ? lastResults.map((r, i) => `<button class="result" data-act="pick" data-i="${i}">${coverHTML(r)}<span><b>${esc(r.fullTitle || r.title)}</b><small>${esc([r.author, r.publisher].filter(Boolean).join(' / '))}</small></span></button>`).join('')
      : '<div class="loading">見つかりませんでした。キーワードを変えるか、少し時間をおいてもう一度お試しください。</div>';
  } catch {
    box.innerHTML = '<div class="loading">検索できませんでした。通信状態を確認してください。</div>';
  }
}

function applyInfo(info) {
  const d = editing.draft;
  for (const k of ['title', 'author', 'publisher', 'isbn', 'cover']) if (info[k]) d[k] = info[k];
  editing.dirty = true;
  renderBasic();
  toast(`「${info.title}」の情報を入れました`);
}

/* ---------- バーコード読み取り ---------- */
let scanner = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
async function stopScanner() {
  const s = scanner; scanner = null;
  if (!s) return;
  try { if (s.isScanning) await s.stop(); s.clear(); } catch {}
}
async function openScanner() {
  if (!window.isSecureContext) { toast('カメラは https のページでのみ使えます'); return; }
  openModal(`
    <h3>バーコードを読み取る</h3>
    <p class="hint">本の裏表紙にある<b>上の段（978から始まる）</b>のバーコードを枠に合わせてください。</p>
    <div id="reader"><div class="loading" style="color:#fff;padding:20px">カメラを準備しています…</div></div>
    <div class="modal-actions" style="margin-top:12px"><button class="btn" data-act="close-modal">やめる</button></div>`, stopScanner);
  try {
    await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
  } catch { toast('読み取り機能を読み込めませんでした'); closeModal(); return; }
  if ($('#modal').hidden) return;
  $('#reader').innerHTML = '';
  const s = new Html5Qrcode('reader', {
    formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  });
  scanner = s;
  let handled = false;
  try {
    await s.start({ facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.85, 320)), height: Math.floor(Math.min(h * 0.45, 140)) }) },
      async (text) => {
        const isbn = normIsbn(text);
        if (!isbn || handled) return; // 下の段（192…）は無視
        handled = true;
        if (navigator.vibrate) navigator.vibrate(60);
        await closeModal();
        $('#lookupQ').value = isbn;
        doLookup();
      }, () => {});
  } catch {
    toast('カメラを起動できませんでした。カメラの許可を確認してください');
    closeModal();
  }
}

/* =========================================================
   LINEで送る（送る項目を選べる）
   ========================================================= */
const SHARE_OPTS = [
  ['rating', '評価'], ['oneLine', 'ひとこと紹介'], ['summary', '簡単な紹介'],
  ['chapters', '章ごとのまとめ'], ['quotes', '心に残った一文'], ['actions', 'すぐに行動に移すこと'],
];
const SHARE_DEFAULT = { rating: true, oneLine: true, summary: true, chapters: false, quotes: true, actions: true };

function shareAvailable(b, k) {
  if (k === 'rating') return !!b.rating;
  if (k === 'oneLine' || k === 'summary') return !!b[k]?.trim();
  if (k === 'chapters') return b.chapters.some((c) => c.body.trim());
  if (k === 'quotes' || k === 'actions') return b[k].some((x) => x.text.trim());
  return false;
}

function composeText(b, sel, chSel) {
  const out = [`📖『${b.title}』`];
  if (b.author) out.push(`著：${b.author}`);
  if (sel.rating && b.rating) out.push('★'.repeat(b.rating) + '☆'.repeat(5 - b.rating));
  const block = (head, body) => { out.push('', `【${head}】`, body); };
  if (sel.oneLine && b.oneLine.trim()) block('ひとことで言うと', b.oneLine.trim());
  if (sel.summary && b.summary.trim()) block('簡単な紹介', b.summary.trim());
  if (sel.chapters) {
    // 章ごとに見出しを分けて並べる
    b.chapters.forEach((c, i) => {
      if (c.body.trim() && chSel.has(i)) block(c.title.trim() || '（無題）', c.body.trim());
    });
  }
  if (sel.quotes) {
    const qs = b.quotes.filter((q) => q.text.trim());
    if (qs.length) block('心に残った一文', qs.map((q) => `「${q.text.trim()}」`).join('\n'));
  }
  if (sel.actions) {
    const as = b.actions.filter((a) => a.text.trim());
    if (as.length) block('すぐに行動に移すこと', as.map((a) => `${a.done ? '✅' : '□'} ${a.text.trim()}`).join('\n'));
  }
  return out.join('\n');
}

// onlyChapter を渡すと「その章だけ」を選んだ状態で開く
function openShare(b, onlyChapter) {
  const single = onlyChapter != null;
  const sel = single
    ? { rating: false, oneLine: false, summary: false, chapters: true, quotes: false, actions: false }
    : { ...SHARE_DEFAULT, ...pref.get('shareSel', {}) };
  const chList = b.chapters.map((c, i) => ({ c, i })).filter((x) => x.c.body.trim());
  const chSel = new Set(single ? [onlyChapter] : chList.map((x) => x.i));

  openModal(`
    <h3>LINEで送る</h3>
    <p class="hint">送る内容を選んでください。下の文面は送る前に直せます。</p>
    <div class="opts">${SHARE_OPTS.map(([k, label]) => {
      const ok = shareAvailable(b, k);
      return `<label class="${ok ? '' : 'disabled'}"><input type="checkbox" data-share="${k}" ${ok && sel[k] ? 'checked' : ''} ${ok ? '' : 'disabled'}>${label}</label>`;
    }).join('')}</div>
    <div class="ch-pick" id="chPick" ${sel.chapters && chList.length ? '' : 'hidden'}>
      <div class="ch-pick-head">
        <span>送る章</span>
        <button class="sec-link" type="button" data-ch-all="1">すべて選ぶ</button>
        <button class="sec-link" type="button" data-ch-all="0">すべて外す</button>
      </div>
      <div class="ch-list">${chList.map((x) => `<label class="ch-chip"><input type="checkbox" data-ch="${x.i}" ${chSel.has(x.i) ? 'checked' : ''}><span>${esc(x.c.title.trim() || '（無題）')}</span></label>`).join('')}</div>
    </div>
    <textarea class="preview" id="sharePreview" aria-label="送る文面"></textarea>
    <div class="preview-meta"><span id="shareLen"></span><span id="shareWarn" class="warn"></span></div>
    <div class="modal-actions">
      <button class="btn" data-act="copy">コピー</button>
      <a class="btn line" id="lineLink" target="_blank" rel="noopener">${ICON.line}LINEで送る</a>
    </div>`);

  const pv = $('#sharePreview');
  const sync = () => {
    const text = pv.value;
    const n = [...text].length;
    $('#shareLen').textContent = `${n.toLocaleString()}字`;
    $('#shareWarn').textContent = n > 1500 ? '長いと送れないことがあります。章を分けて送るか、「コピー」して貼り付けてください' : '';
    $('#lineLink').href = 'https://line.me/R/share?text=' + encodeURIComponent(text);
  };
  const rebuild = () => { pv.value = composeText(b, sel, chSel); sync(); };
  document.querySelectorAll('[data-share]').forEach((cb) => cb.addEventListener('change', () => {
    sel[cb.dataset.share] = cb.checked;
    if (!single) pref.set('shareSel', sel);
    $('#chPick').hidden = !(sel.chapters && chList.length);
    rebuild();
  }));
  document.querySelectorAll('[data-ch]').forEach((cb) => cb.addEventListener('change', () => {
    const i = +cb.dataset.ch;
    if (cb.checked) chSel.add(i); else chSel.delete(i);
    rebuild();
  }));
  document.querySelectorAll('[data-ch-all]').forEach((btn) => btn.addEventListener('click', () => {
    const on = btn.dataset.chAll === '1';
    document.querySelectorAll('[data-ch]').forEach((cb) => { cb.checked = on; on ? chSel.add(+cb.dataset.ch) : chSel.delete(+cb.dataset.ch); });
    rebuild();
  }));
  pv.addEventListener('input', sync);
  rebuild();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('コピーしました');
}

/* =========================================================
   データの管理（書き出し・読み込み）
   ========================================================= */
async function openSettings() {
  if (Cloud && !Cloud.user) { toast('先にログインしてください'); return; }
  const books = await Store.list();
  const cloud = !!Cloud;
  openModal(`
    <h3>データの管理</h3>
    ${cloud ? `
      <div class="account">
        ${Cloud.user.photoURL ? `<img src="${esc(Cloud.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div><b>${esc(Cloud.user.displayName || 'ログイン中')}</b><small>${esc(Cloud.user.email || '')}</small></div>
        <button class="btn small" data-act="logout">ログアウト</button>
      </div>
      <p class="hint">記録はクラウドに保存され、同じGoogleアカウントでログインしたスマホとPCで同じ内容が見られます（${books.length}冊）。</p>`
    : `<p class="hint">記録は今、この端末のブラウザの中に保存されています（${books.length}冊）。</p>`}
    <div class="settings-list">
      <button class="btn block" data-act="export">バックアップを書き出す（ファイル保存）</button>
      <label class="btn block">バックアップを読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label>
    </div>
    <div class="note-box">
      ${cloud
        ? '・バックアップの書き出しは、念のための控えとして使えます。読み込むと、同じ本は新しい方が残ります。'
        : `・別の端末に移すときは、書き出したファイルを移して「読み込む」を押してください。同じ本は新しい方が残ります。<br>
      ・ブラウザのデータを消すと記録も消えるので、ときどき書き出しておくと安心です。`}
    </div>
    <div class="modal-actions" style="margin-top:14px"><button class="btn" data-act="close-modal">閉じる</button></div>`);
}

async function exportData() {
  const books = await Store.list();
  const blob = new Blob([JSON.stringify({ app: 'book-output-note', version: 1, exportedAt: new Date().toISOString(), books }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `読書ノート_${today().replace(/-/g, '')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('書き出しました');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.books;
    if (!Array.isArray(incoming)) throw new Error();
    const current = await Store.list();
    const map = new Map(current.map((b) => [b.id, b]));
    let added = 0, updated = 0;
    for (const b of incoming) {
      if (!b?.id || !b.title) continue;
      const nb = { ...newBook(), ...b };
      const old = map.get(b.id);
      if (!old) { map.set(b.id, nb); added++; }
      else if ((b.updatedAt || 0) > (old.updatedAt || 0)) { map.set(b.id, nb); updated++; }
    }
    await Store.replaceAll([...map.values()]);
    await closeModal();
    toast(`読み込みました（追加${added}冊・更新${updated}冊）`);
    route();
  } catch { toast('このファイルは読み込めませんでした'); }
}

/* =========================================================
   操作の受け付け（まとめて処理）
   ========================================================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const act = el.dataset.act;
  switch (act) {
    case 'close-modal': closeModal(); break;
    case 'settings': openSettings(); break;
    case 'export': exportData(); break;
    case 'login': doLogin(el); break;
    case 'logout':
      if (await askConfirm('ログアウトしますか？ もう一度ログインすれば、記録はそのまま見られます。', 'ログアウト')) {
        await Cloud.signOut(); toast('ログアウトしました');
      }
      break;
    case 'cancel': history.length > 1 ? history.back() : (location.hash = '#/'); break;
    case 'save': saveDraft(); break;
    case 'add': addItem(el.dataset.list); break;
    case 'remove': removeItem(el.dataset.list, +el.dataset.i); break;
    case 'rate': {
      const v = +el.dataset.v;
      editing.draft.rating = editing.draft.rating === v ? 0 : v;
      editing.dirty = true;
      document.querySelectorAll('.rating button').forEach((b) => b.classList.toggle('on', +b.dataset.v <= editing.draft.rating));
      break;
    }
    case 'cover-clear': editing.draft.cover = ''; editing.dirty = true; renderBasic(); break;
    case 'scan': openScanner(); break;
    case 'lookup': doLookup(); break;
    case 'pick': applyInfo(lastResults[+el.dataset.i]); $('#results').innerHTML = ''; break;
    case 'share': if (viewing) openShare(viewing); break;
    case 'share-ch': if (viewing) openShare(viewing, +el.dataset.i); break;
    case 'more': { const sec = el.closest('.chapter'); toggleChapter(sec, !sec.classList.contains('open')); break; }
    case 'toggle-all': {
      const open = el.textContent.includes('開く');
      app.querySelectorAll('.chapter').forEach((sec) => toggleChapter(sec, open));
      el.textContent = open ? 'すべて閉じる' : 'すべて開く';
      break;
    }
    case 'copy': copyText($('#sharePreview').value); break;
    case 'delete':
      if (viewing && await askConfirm(`「${viewing.title}」の記録を削除します。元に戻せません。よろしいですか？`, '削除する', true)) {
        await Store.remove(viewing.id); toast('削除しました'); location.hash = '#/';
      }
      break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  const p = t.dataset.path;
  if (!p || !editing) return;
  setPath(editing.draft, p, t.type === 'checkbox' ? t.checked : t.value);
  editing.dirty = true;
  if (t.tagName === 'TEXTAREA') autoGrow(t);
  if (p === 'oneLine') updateCounter();
  const m = p.match(/^chapters\.(\d+)\.(title|body)$/);
  if (m && m[2] === 'body') { const c = $(`[data-count="${m[1]}"]`); if (c) c.textContent = `${[...t.value].length.toLocaleString()}字`; }
  if (p === 'title' && !editing.draft.cover) {
    const ph = $('#basic .cover-ph'); if (ph) { ph.style.background = phColor(t.value || '?'); ph.firstElementChild.textContent = t.value || 'No Title'; }
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'cover-file' && t.files[0]) {
    try { editing.draft.cover = await imageToDataURL(t.files[0]); editing.dirty = true; renderBasic(); }
    catch { toast('画像を読み込めませんでした'); }
  }
  if (t.dataset.act === 'import' && t.files[0]) importData(t.files[0]);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('resize', () => { if (editing) growAll(); });

/* =========================================================
   ログイン（クラウド保存を使うとき）
   ========================================================= */
const inLineApp = /\bLine\//i.test(navigator.userAgent);

function renderLogin() {
  editing = null;
  closeModal();
  app.innerHTML = `
    <div class="empty"><div class="sheet login">
      <h2>ログイン</h2>
      <p>Googleアカウントでログインすると、スマホとPCで同じ記録を見られます。</p>
      ${inLineApp ? `<p class="login-warn">LINEの中で開いているため、ログインできません。<br>右上のメニューから「ブラウザで開く」を選んでください。</p>` : ''}
      <button class="btn primary login-btn" data-act="login">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#fff" opacity=".7" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#fff" opacity=".55" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg>
        Googleでログイン
      </button>
      <p class="login-note">ログインに使うのはお名前とメールアドレスだけです。記録は本人しか見られません。</p>
    </div></div>`;
}

async function doLogin(btn) {
  btn.disabled = true;
  try {
    await Cloud.signIn();
  } catch (e) {
    const code = e?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {}
    else if (code === 'auth/popup-blocked') toast('ログイン画面が開けませんでした。ポップアップを許可してください');
    else if (code === 'auth/unauthorized-domain') toast('このURLがFirebaseの「承認済みドメイン」に登録されていません');
    else if (code === 'auth/network-request-failed') toast('通信できませんでした。電波の状態を確認してください');
    else toast('ログインできませんでした（' + (code || 'エラー') + '）');
  } finally {
    btn.disabled = false;
  }
}

// この端末に保存してあった記録を、初回ログイン時にクラウドへ移す
async function migrateLocal(u) {
  const key = 'migrated:' + u.uid;
  if (pref.get(key, false)) return;
  const local = await LocalStore.list();
  if (local.length) {
    const ok = await askConfirm(`この端末に保存されている記録が${local.length}冊あります。クラウドに移して、スマホとPCで見られるようにしますか？`, 'クラウドに移す');
    if (!ok) { pref.set(key, true); return; }
    const cloud = new Map((await Cloud.store.list()).map((b) => [b.id, b]));
    const toWrite = local.filter((b) => !cloud.has(b.id) || (b.updatedAt || 0) > (cloud.get(b.id).updatedAt || 0));
    await Cloud.store.replaceAll(toWrite);
    toast(`${toWrite.length}冊をクラウドに移しました`);
  }
  pref.set(key, true);
}

let cloudErrorShown = false;
function onCloudError(e) {
  if (cloudErrorShown) return;
  cloudErrorShown = true;
  setTimeout(() => { cloudErrorShown = false; }, 8000);
  if (e?.code === 'permission-denied') toast('クラウドに保存できませんでした（Firestoreのルール設定を確認してください）');
  else toast('クラウドとの通信でエラーが起きました。時間をおいて開き直してください');
}

async function boot() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) { route(); return; } // 設定がなければ、この端末だけに保存
  app.innerHTML = '<p class="blank-note">読み込んでいます…</p>';
  try {
    Cloud = await import('./cloud.js?v=5');
    await Cloud.init(cfg, {
      onUser: async (u) => {
        if (!u) { Store = LocalStore; renderLogin(); return; }
        Store = Cloud.store;
        await Cloud.store.ready;
        route();
        await migrateLocal(u);
        if (!editing) route(true);
      },
      // ほかの端末で変更があったら、編集中でなければ描き直す
      onRemoteChange: () => { if (!editing && $('#modal').hidden) route(true); },
      onError: onCloudError,
    });
  } catch (e) {
    console.error(e);
    Cloud = null; Store = LocalStore;
    toast('クラウドに接続できませんでした。この端末の記録を表示しています');
    route();
  }
}

boot();
