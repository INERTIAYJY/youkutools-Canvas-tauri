/**
 * 浏览器试用：把真实的 Web 构建加载进首屏画框，并预置一份演示画布。
 *
 * 演示数据不复制应用的 IndexedDB schema——那样每次 schema 升级都会失配。
 * 这里的做法是先让应用自己把库建好，再往 projects / metadata 两个 store 里写，
 * 因此对后续 schema 变更是免疫的：拿不到 store 就安静退化成空画布。
 */
(function () {
  'use strict';

  var DB_NAME = 'ai-canvas-db';
  var PROJECT_ID = 'aicanvas-web-demo';
  var LAST_ACTIVE_KEY = 'last-active-project';
  var APP_URL = 'app/';

  var shot = document.getElementById('shot');
  if (!shot) return;

  var stage = shot.querySelector('.shot-stage');
  var tryBtn = document.getElementById('tryBtn');
  var loading = shot.querySelector('.try-loading');
  var loadingText = shot.querySelector('.try-loading-text');
  var note = document.getElementById('demoNote');
  var exitBtn = document.getElementById('demoExit');
  var frame = null;
  var started = false;

  function setStatus(text) {
    if (loadingText) loadingText.textContent = text;
  }

  /** 不指定版本打开：库存在则用当前版本，不存在会建一个空库（应用随后自行升级补齐） */
  function openCurrent() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
  }

  /** 应用是否已经把需要的 store 建出来了 */
  function hasStores() {
    return openCurrent().then(function (db) {
      var ok = db.objectStoreNames.contains('projects')
        && db.objectStoreNames.contains('metadata');
      // 必须立刻关闭：留着连接会挡住应用后续的版本升级
      db.close();
      return ok;
    }).catch(function () { return false; });
  }

  /** 读 last-active-project；应用首启会写它，用来判断初始化是否已经落定 */
  function readLastActive() {
    return openCurrent().then(function (db) {
      if (!db.objectStoreNames.contains('metadata')) {
        db.close();
        return null;
      }
      return new Promise(function (resolve) {
        var req = db.transaction('metadata', 'readonly')
          .objectStore('metadata')
          .get(LAST_ACTIVE_KEY);
        req.onsuccess = function () {
          db.close();
          resolve(req.result ? req.result.projectId : null);
        };
        req.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function writeDemo(payload) {
    return openCurrent().then(function (db) {
      return new Promise(function (resolve, reject) {
        var now = Date.now();
        var tx = db.transaction(['projects', 'metadata'], 'readwrite');
        tx.objectStore('projects').put({
          id: PROJECT_ID,
          name: payload.name || '演示项目',
          createdAt: now,
          updatedAt: now,
          dataFolder: 'web-demo',
          nodes: payload.nodes || [],
          edges: payload.edges || [],
        });
        tx.objectStore('metadata').put({
          id: LAST_ACTIVE_KEY,
          projectId: PROJECT_ID,
          updatedAt: now,
        });
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  /**
   * 每次都换一个新的 iframe 元素。
   * 复用同一个元素重新赋同样的 src 不保证再次触发 load 事件，会把界面卡在加载态。
   */
  function loadFrame() {
    return new Promise(function (resolve) {
      var next = document.createElement('iframe');
      next.className = 'demo-frame';
      next.title = 'AI Canvas 浏览器演示';

      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        if (frame && frame !== next) frame.remove();
        frame = next;
        resolve();
      };
      next.addEventListener('load', finish, { once: true });
      // 应用初始化失败时不要把界面永久卡在加载态
      setTimeout(finish, 20000);
      next.src = APP_URL;
      stage.appendChild(next);
    });
  }

  function waitFor(check, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve) {
      (function poll() {
        check().then(function (ok) {
          if (ok) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(poll, 300);
        });
      })();
    });
  }

  function start() {
    if (started) return;
    started = true;

    shot.classList.add('is-demo');
    if (loading) loading.hidden = false;
    if (tryBtn) tryBtn.hidden = true;
    setStatus('正在加载应用…');

    var payloadPromise = fetch('demo/canvas.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });

    Promise.all([payloadPromise, hasStores()])
      .then(function (results) {
        var payload = results[0];
        var ready = results[1];
        if (!payload) return loadFrame();

        // 库还没建好：先让应用跑一次把 store 建出来，再写演示数据。
        // 必须等到应用首启把自己的默认项目和 last-active 写完，否则它会盖掉我们的种子。
        var prepared = ready
          ? Promise.resolve(true)
          : loadFrame().then(function () {
              setStatus('正在准备演示画布…');
              return waitFor(hasStores, 15000);
            }).then(function (ok) {
              if (!ok) return false;
              return waitFor(function () {
                return readLastActive().then(function (id) { return !!id; });
              }, 10000).then(function () { return true; });
            });

        return prepared.then(function (ok) {
          if (!ok) return loadFrame();
          return writeDemo(payload)
            .catch(function () { /* 写失败就退化成空画布 */ })
            .then(function () {
              setStatus('正在打开演示画布…');
              return loadFrame();
            });
        });
      })
      .then(function () {
        if (loading) loading.hidden = true;
        if (note) note.hidden = false;
        if (exitBtn) exitBtn.hidden = false;
        shot.classList.add('is-live');
      })
      .catch(function () {
        if (loading) loading.hidden = true;
        if (tryBtn) tryBtn.hidden = false;
        shot.classList.remove('is-demo');
        started = false;
      });
  }

  function stop() {
    stage.querySelectorAll('.demo-frame').forEach(function (el) { el.remove(); });
    frame = null;
    started = false;
    shot.classList.remove('is-demo', 'is-live');
    if (loading) loading.hidden = true;
    if (note) note.hidden = true;
    if (exitBtn) exitBtn.hidden = true;
    if (tryBtn) tryBtn.hidden = false;
  }

  if (tryBtn) tryBtn.addEventListener('click', start);
  if (exitBtn) exitBtn.addEventListener('click', stop);
})();
