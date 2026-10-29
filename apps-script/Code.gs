/**
 * 리그전 기록판 백엔드 (구글 시트에 연결된 Apps Script)
 * 탁구용 시트와 배드민턴용 시트에 같은 코드를 각각 붙여넣어 따로 배포합니다.
 * 학생 이름은 이 시트의 Students 탭에만 있습니다.
 */
const TZ = 'Asia/Seoul';
const HEAD = {
  Students: ['학년', '반', '번호', '이름', '성별'],
  Config: ['항목', '값'],
  Groups: ['반', '조', '팀번호', '번호들'],
  Scores: ['반', '경기', '1세트 왼쪽', '1세트 오른쪽', '2세트 왼쪽', '2세트 오른쪽', '3세트 왼쪽', '3세트 오른쪽', '입력시각', '입력자', '확정'],
  Log: ['시각', '권한', '입력자', '내용']
};
const CFG_LABEL = {
  student_code: '학생코드', admin_code: '교사코드', mode: '방식(single 또는 double)',
  size: '조 크기', sets: '세트 수(1 또는 3)', win: '승점 승', draw: '승점 무', loss: '승점 패'
};
const SCORE_COLS = 11;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('리그전').addItem('시트 준비하기', 'setup').addToUi();
}

/** 필요한 탭을 만들고 기본 설정과 접속 코드를 채웁니다. 여러 번 실행해도 기존 내용은 지우지 않습니다. */
function setup() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEAD).forEach(function (name) {
    let sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]);
    sh.setFrozenRows(1);
  });
  const cfg = book.getSheetByName('Config');
  if (cfg.getLastRow() <= 1) {
    const rnd = function (n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; };
    cfg.getRange(2, 1, 8, 2).setValues([
      [CFG_LABEL.student_code, rnd(4)], [CFG_LABEL.admin_code, rnd(6)],
      [CFG_LABEL.mode, 'single'], [CFG_LABEL.size, 5], [CFG_LABEL.sets, 1],
      [CFG_LABEL.win, 3], [CFG_LABEL.draw, 1], [CFG_LABEL.loss, 0]
    ]);
    cfg.getRange(2, 2, 2, 1).setNumberFormat('@');
  }
  try { SpreadsheetApp.getUi().alert('준비가 끝났습니다. Config 탭에서 학생코드와 교사코드를 확인하세요.'); } catch (e) {}
}

/* ---------- 시트 읽기 ---------- */
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('먼저 메뉴 리그전 > 시트 준비하기를 실행하세요.');
  return sh;
}
function rows_(name) { return sheet_(name).getDataRange().getValues().slice(1); }
function stamp_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  return String(v || '');
}
function config_() {
  const map = {};
  rows_('Config').forEach(function (r) { map[String(r[0]).trim()] = r[1]; });
  const o = {};
  Object.keys(CFG_LABEL).forEach(function (k) { o[k] = map[CFG_LABEL[k]]; });
  return {
    student_code: String(o.student_code === undefined ? '' : o.student_code).trim(),
    admin_code: String(o.admin_code === undefined ? '' : o.admin_code).trim(),
    mode: o.mode === 'double' ? 'double' : 'single',
    size: Number(o.size) >= 2 ? Number(o.size) : 5,
    sets: Number(o.sets) === 3 ? 3 : 1,
    win: Number(o.win === '' || o.win === undefined ? 3 : o.win),
    draw: Number(o.draw === '' || o.draw === undefined ? 1 : o.draw),
    loss: Number(o.loss === '' || o.loss === undefined ? 0 : o.loss)
  };
}
function roleOf_(cfg, code) {
  const c = String(code === undefined || code === null ? '' : code).trim();
  if (c && cfg.admin_code && c === cfg.admin_code) return 'admin';
  if (!cfg.student_code) return 'student'; // 학생코드를 비워 두면 학생은 코드 없이 입장합니다.
  if (c && c === cfg.student_code) return 'student';
  return null;
}
function isLocked_(v) {
  return v === true || /^(true|y|yes|확정)$/i.test(String(v).trim());
}

/* ---------- 요청 처리 ---------- */
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return out_({ ok: true, message: '리그전 기록판 서버가 켜져 있습니다.' }); }

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const cfg = config_();
    const role = roleOf_(cfg, p.code);
    if (!role) return out_({ ok: false, code: 'bad_code', error: '코드가 맞지 않습니다.' });
    if (p.action === 'load') return out_(load_(cfg, role));
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      if (p.action === 'saveScore') return out_(saveScore_(p, role));
      if (role !== 'admin') return out_({ ok: false, code: 'forbidden', error: '교사만 할 수 있습니다.' });
      if (p.action === 'saveGroups') return out_(saveGroups_(p));
      if (p.action === 'saveConfig') return out_(saveConfig_(p));
      if (p.action === 'setLock') return out_(setLock_(p));
      return out_({ ok: false, error: '알 수 없는 요청입니다.' });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function load_(cfg, role) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('load');
  if (hit) { const d = JSON.parse(hit); d.role = role; return d; }
  const students = rows_('Students').filter(function (r) { return String(r[3]).trim() !== ''; })
    .map(function (r) { return { cls: Number(r[1]), no: Number(r[2]), name: String(r[3]).trim(), sex: String(r[4] || '') }; });
  const groups = rows_('Groups').filter(function (r) { return r[0] !== ''; })
    .map(function (r) { return { cls: Number(r[0]), group: Number(r[1]), entry: Number(r[2]), members: String(r[3]) }; });
  const scores = rows_('Scores').filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const sets = [];
    for (let i = 0; i < 3; i++) sets.push([r[2 + i * 2], r[3 + i * 2]]);
    return { cls: Number(r[0]), key: String(r[1]), sets: sets, at: stamp_(r[8]), by: String(r[9]), locked: isLocked_(r[10]) };
  });
  const data = {
    ok: true, role: role, students: students, groups: groups, scores: scores,
    config: { mode: cfg.mode, size: cfg.size, sets: cfg.sets, win: cfg.win, draw: cfg.draw, loss: cfg.loss }
  };
  try { cache.put('load', JSON.stringify(data), 20); } catch (e) {}
  return data;
}

/** 쓰기 뒤에는 캐시를 비워 모두에게 바로 보이게 합니다. */
function bust_() { CacheService.getScriptCache().remove('load'); }

function cleanSets_(sets, n) {
  if (!Array.isArray(sets) || sets.length > 3) throw new Error('점수 형식이 올바르지 않습니다.');
  const res = [];
  for (let i = 0; i < 3; i++) {
    const s = sets[i] || ['', ''];
    const pair = [s[0], s[1]].map(function (v) {
      if (v === '' || v === null || v === undefined) return '';
      const x = Number(v);
      if (!isFinite(x) || x < 0 || x > 99 || Math.floor(x) !== x) throw new Error('점수는 0부터 99까지의 정수로 입력하세요.');
      return x;
    });
    res.push(i < n ? pair : ['', '']);
  }
  return res;
}

function saveScore_(p, role) {
  const cls = Number(p.cls), key = String(p.key);
  if (!(cls > 0) || !/^\d+-\d+$/.test(key)) throw new Error('경기 정보가 올바르지 않습니다.');
  const cfg = config_();
  const sets = cleanSets_(p.sets, cfg.sets);
  const sh = sheet_('Scores');
  const data = sh.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][0]) === cls && String(data[i][1]) === key) { row = i + 1; break; }
  }
  if (row > 0 && isLocked_(data[row - 1][10]) && role !== 'admin') {
    return { ok: false, code: 'locked', error: '선생님이 확정한 경기는 고칠 수 없습니다.' };
  }
  const who = String(p.who || '').slice(0, 40);
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const locked = row > 0 ? data[row - 1][10] : '';
  const rec = [cls, key, sets[0][0], sets[0][1], sets[1][0], sets[1][1], sets[2][0], sets[2][1], now, who, locked];
  if (row > 0) sh.getRange(row, 1, 1, SCORE_COLS).setValues([rec]);
  else sh.appendRow(rec);
  sheet_('Log').appendRow([now, role, who, cls + '반 ' + key + ' ' + JSON.stringify(sets)]);
  bust_();
  return { ok: true, at: now };
}

function saveGroups_(p) {
  const cls = Number(p.cls);
  if (!(cls > 0) || !Array.isArray(p.entries) || !Array.isArray(p.groups)) throw new Error('조 편성 정보가 올바르지 않습니다.');
  const keepRows = function (name) {
    return rows_(name).filter(function (r) { return Number(r[0]) !== cls && r[0] !== ''; });
  };
  const rewrite = function (name, keep, add, textCol) {
    const sh = sheet_(name);
    const all = keep.concat(add);
    const w = HEAD[name].length;
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, w).clearContent();
    if (all.length) {
      if (textCol) sh.getRange(2, textCol, all.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, all.length, w).setValues(all);
    }
  };
  const byId = {};
  p.entries.forEach(function (en) { byId[en.id] = en; });
  const add = [];
  p.groups.forEach(function (g, gi) {
    g.forEach(function (id) {
      const en = byId[id];
      if (!en) throw new Error('팀 정보가 없습니다.');
      add.push([cls, gi + 1, Number(id), en.members.join(' ')]);
    });
  });
  rewrite('Groups', keepRows('Groups'), add, 4);
  rewrite('Scores', keepRows('Scores').map(function (r) { return r.slice(0, SCORE_COLS); }), [], 0);
  sheet_('Log').appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), 'admin', '교사', cls + '반 조 편성 ' + p.groups.length + '개 조']);
  bust_();
  return { ok: true };
}

function saveConfig_(p) {
  const v = p.values || {};
  const sh = sheet_('Config');
  const data = sh.getDataRange().getValues();
  const allowed = { mode: 1, size: 1, sets: 1, win: 1, draw: 1, loss: 1 };
  Object.keys(v).forEach(function (k) {
    if (!allowed[k]) return;
    let val = v[k];
    if (k === 'mode') val = val === 'double' ? 'double' : 'single';
    else if (k === 'sets') val = Number(val) === 3 ? 3 : 1;
    else {
      val = Number(val);
      if (!isFinite(val)) throw new Error('숫자를 입력하세요.');
    }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === CFG_LABEL[k]) { sh.getRange(i + 1, 2).setValue(val); break; }
    }
  });
  bust_();
  return { ok: true };
}

function setLock_(p) {
  const cls = Number(p.cls), val = p.locked ? '확정' : '';
  const sh = sheet_('Scores');
  const data = sh.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][0]) !== cls) continue;
    if (p.key && String(data[i][1]) !== String(p.key)) continue;
    sh.getRange(i + 1, SCORE_COLS).setValue(val);
    n++;
  }
  bust_();
  return { ok: true, count: n };
}
