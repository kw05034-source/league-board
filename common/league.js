/* 리그전 기록판 화면. 설정은 각 종목 폴더의 config.js, 데이터는 구글 시트(Apps Script)에서 옵니다. */
(function () {
  'use strict';
  var C = window.LEAGUE;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var P = 'league-' + C.grade + '-';
  var S = { code: ls.get(P + 'code') || '', role: '', cfg: {}, students: [], entries: {}, groups: {}, scores: {},
    cls: 1, view: 'play', who: null, status: '', armed: null, err: '', pick: false };
  try { S.who = JSON.parse(ls.get(P + 'who')); } catch (e) {}
  var pending = {}, timers = {};

  /* ---------- 서버 통신 ---------- */
  function api(action, params) {
    if (!C.api || /^PASTE/.test(C.api)) return Promise.reject(Object.assign(new Error('config.js에 Apps Script 주소가 없습니다.'), { code: 'noapi' }));
    var body = JSON.stringify(Object.assign({ action: action, code: S.code }, params || {}));
    return fetch(C.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { var e = new Error(j.error || '오류가 났습니다.'); e.code = j.code; throw e; }
        return j;
      });
  }
  function stu(cls, no) { return S.students.find(function (s) { return s.cls === cls && s.no === no; }); }
  function apply(j) {
    S.role = j.role; S.cfg = j.config; S.students = j.students;
    S.entries = {}; S.groups = {};
    var rows = j.groups.slice().sort(function (a, b) { return a.cls - b.cls || a.group - b.group || a.entry - b.entry; });
    rows.forEach(function (g) {
      var m = String(g.members).trim().split(/\s+/).filter(Boolean).map(function (n) { return stu(g.cls, +n); }).filter(Boolean);
      (S.entries[g.cls] = S.entries[g.cls] || {})[g.entry] = { id: g.entry, m: m };
      var arr = (S.groups[g.cls] = S.groups[g.cls] || []);
      (arr[g.group - 1] = arr[g.group - 1] || []).push(g.entry);
    });
    var sc = {};
    j.scores.forEach(function (r) {
      var id = r.cls + '|' + r.key;
      sc[id] = pending[id] && S.scores[id] ? S.scores[id] : { sets: r.sets, locked: r.locked, by: r.by, at: r.at };
    });
    Object.keys(pending).forEach(function (id) { if (!sc[id] && S.scores[id]) sc[id] = S.scores[id]; });
    S.scores = sc;
    var cl = classes();
    if (cl.length && cl.indexOf(S.cls) < 0) S.cls = cl[0];
  }
  function classes() {
    var set = {}; S.students.forEach(function (s) { set[s.cls] = 1; });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function refresh(force) {
    return api('load').then(function (j) {
      var before = JSON.stringify([S.groups, S.scores, S.cfg]);
      apply(j);
      var after = JSON.stringify([S.groups, S.scores, S.cfg]);
      var typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.match');
      if (force || (before !== after && !typing)) render();
    });
  }

  /* ---------- 경기 계산 ---------- */
  function schedule(ids) {
    var a = ids.slice(); if (a.length % 2) a.push(null);
    var n = a.length, rounds = [];
    for (var r = 0; r < n - 1; r++) {
      var ms = [];
      for (var i = 0; i < n / 2; i++) { var x = a[i], y = a[n - 1 - i]; if (x !== null && y !== null) ms.push([x, y]); }
      rounds.push(ms); a.splice(1, 0, a.pop());
    }
    return rounds;
  }
  function setsOf(cls, key) { var s = S.scores[cls + '|' + key]; return s ? s.sets : []; }
  function result(sets) {
    var f = sets.filter(function (s) { return s && s[0] !== '' && s[1] !== '' && s[0] != null && s[1] != null; });
    if (!f.length) return null;
    var wa = 0, wb = 0, pa = 0, pb = 0;
    f.forEach(function (s) { var x = +s[0], y = +s[1]; pa += x; pb += y; if (x > y) wa++; else if (y > x) wb++; });
    var w;
    if (S.cfg.sets === 1) w = pa > pb ? 'a' : pa < pb ? 'b' : 'd'; else w = wa > wb ? 'a' : wb > wa ? 'b' : 'd';
    return { wa: wa, wb: wb, pa: pa, pb: pb, w: w };
  }
  function standings(cls, gi) {
    var ids = S.groups[cls][gi], rows = {}, c = S.cfg;
    ids.forEach(function (id) { rows[id] = { id: id, p: 0, w: 0, d: 0, l: 0, pt: 0, sf: 0, sa: 0, pf: 0, pa: 0 }; });
    schedule(ids).forEach(function (rd) { rd.forEach(function (m) {
      var x = m[0], y = m[1], r = result(setsOf(cls, x + '-' + y)); if (!r) return;
      var A = rows[x], B = rows[y]; A.p++; B.p++;
      A.sf += r.wa; A.sa += r.wb; B.sf += r.wb; B.sa += r.wa; A.pf += r.pa; A.pa += r.pb; B.pf += r.pb; B.pa += r.pa;
      if (r.w === 'a') { A.w++; B.l++; A.pt += c.win; B.pt += c.loss; }
      else if (r.w === 'b') { B.w++; A.l++; B.pt += c.win; A.pt += c.loss; }
      else { A.d++; B.d++; A.pt += c.draw; B.pt += c.draw; }
    }); });
    return Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) {
      return b.pt - a.pt || (b.sf - b.sa) - (a.sf - a.sa) || (b.pf - b.pa) - (a.pf - a.pa) || a.id - b.id; });
  }
  function progress(cls) {
    var t = 0, d = 0;
    (S.groups[cls] || []).forEach(function (g) { schedule(g).forEach(function (rd) { rd.forEach(function (m) {
      t++; if (result(setsOf(cls, m[0] + '-' + m[1]))) d++; }); }); });
    return [d, t];
  }

  /* ---------- 화면 조각 ---------- */
  function label(e) { return e.m.map(function (s) { return '<span class="no">' + s.no + '</span>' + esc(s.name); }).join(' · '); }
  function standHtml(cls, gi) {
    var rows = standings(cls, gi), any = rows.some(function (r) { return r.p; }), ent = S.entries[cls];
    return '<div class="tbl"><table><thead><tr><th>순위</th><th class="nm">이름</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승점</th><th>세트</th><th>득실</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var d = r.pf - r.pa;
        return '<tr class="' + (i === 0 && any ? 'first' : '') + '"><td class="rank">' + (any ? i + 1 : '-') + '</td><td class="nm">' + label(ent[r.id]) + '</td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td><b>' + r.pt + '</b></td><td>' + r.sf + ':' + r.sa + '</td><td>' + (d > 0 ? '+' : '') + d + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function matchHtml(cls, gi, x, y) {
    var key = x + '-' + y, rec = S.scores[cls + '|' + key], sets = rec ? rec.sets : [], n = S.cfg.sets, r = result(sets);
    var locked = rec && rec.locked && S.role !== 'admin', ent = S.entries[cls], inputs = '';
    for (var i = 0; i < n; i++) {
      var s = sets[i] || ['', ''], pre = n > 1 ? (i + 1) + '세트 ' : '';
      inputs += '<div class="set">' + (n > 1 ? '<span>' + (i + 1) + '세트</span>' : '') +
        '<input type="number" inputmode="numeric" min="0" max="99" aria-label="' + pre + '왼쪽 점수" data-k="' + key + '" data-i="' + i + '" data-s="0" value="' + s[0] + '"' + (locked ? ' disabled' : '') + '>' +
        '<span>:</span>' +
        '<input type="number" inputmode="numeric" min="0" max="99" aria-label="' + pre + '오른쪽 점수" data-k="' + key + '" data-i="' + i + '" data-s="1" value="' + s[1] + '"' + (locked ? ' disabled' : '') + '></div>';
    }
    var tags = (n > 1 && r ? '<span class="tag done">' + r.wa + ' : ' + r.wb + '</span>' : '') + (rec && rec.locked ? '<span class="tag lock">확정</span>' : '');
    return '<div class="match" data-g="' + gi + '" data-k="' + key + '"><div class="side ' + (r && r.w === 'a' ? 'win' : '') + '">' + label(ent[x]) + '</div><div class="sc">' + inputs + tags + '</div><div class="side r ' + (r && r.w === 'b' ? 'win' : '') + '">' + label(ent[y]) + '</div></div>';
  }
  function whoStr() { return S.role === 'admin' ? '교사' : (S.who ? S.who.cls + '반 ' + S.who.no + '번 ' + S.who.name : ''); }
  function setStatus() { var el = $('#status'); if (el) { el.textContent = S.status; el.className = 'msg' + (/실패|수 없/.test(S.status) ? ' err' : ''); } }

  /* ---------- 렌더 ---------- */
  function render() {
    $('#title').textContent = C.title;
    document.title = C.title;
    setStatus();
    if (!S.role) { renderGate(); return; }
    var cls = classes();
    $('#sub').textContent = S.role === 'admin' ? '교사 모드' : '';
    $('#clsBar').innerHTML = cls.map(function (c) { return '<button class="tab" aria-pressed="' + (c === S.cls) + '" data-cls="' + c + '">' + c + '반</button>'; }).join('');
    var views = [['play', '경기 입력'], ['table', '순위표']]; if (S.role === 'admin') views.push(['admin', '교사 관리']);
    $('#viewBar').innerHTML = views.map(function (v) { return '<button class="tab" aria-pressed="' + (v[0] === S.view) + '" data-view="' + v[0] + '">' + v[1] + '</button>'; }).join('') +
      '<span class="grow"></span>' + (S.role === 'admin' ? '<button class="tab" data-act="logout">교사 나가기</button>' : '<button class="tab" data-act="teacher">교사 입장</button>' + (S.code ? '<button class="tab" data-act="logout">나가기</button>' : ''));
    var banner = '';
    if (S.role === 'student' && S.who && !S.pick) banner = '<div class="bar"><span class="msg">입력자: ' + esc(whoStr()) + '</span><button class="tab" data-act="repick">바꾸기</button></div>';
    $('#banner').innerHTML = banner;
    var m = $('#main');
    if (S.view === 'admin' && S.role === 'admin') { m.innerHTML = adminHtml(); return; }
    if (S.role === 'student' && S.view === 'play' && (!S.who || S.pick)) { m.innerHTML = pickHtml(); return; }
    var g = S.groups[S.cls];
    if (!g || !g.length) {
      m.innerHTML = '<div class="card empty">' + S.cls + '반 조 편성이 아직 없습니다.' + (S.role === 'admin' ? '<br>교사 관리에서 조를 편성하세요.' : '<br>선생님이 조를 편성하면 여기에 경기가 나타납니다.') + '</div>';
      return;
    }
    var pr = progress(S.cls), head = '<div class="prog">' + S.cls + '반 진행 ' + pr[0] + ' / ' + pr[1] + '경기</div>';
    if (S.view === 'table') {
      m.innerHTML = head + '<div class="groups">' + g.map(function (_, gi) { return '<div class="card"><h2>' + (gi + 1) + '조</h2>' + standHtml(S.cls, gi) + '</div>'; }).join('') + '</div>';
      return;
    }
    m.innerHTML = head + '<div class="groups">' + g.map(function (ids, gi) {
      return '<div class="card" data-card="' + gi + '"><h2>' + (gi + 1) + '조</h2><div class="st">' + standHtml(S.cls, gi) + '</div>' +
        schedule(ids).map(function (rd, ri) { return '<div><div class="round">' + (ri + 1) + '라운드</div>' + rd.map(function (mm) { return matchHtml(S.cls, gi, mm[0], mm[1]); }).join('') + '</div>'; }).join('') + '</div>';
    }).join('') + '</div>';
  }
  function renderGate() {
    $('#sub').textContent = ''; $('#clsBar').innerHTML = ''; $('#viewBar').innerHTML = ''; $('#banner').innerHTML = '';
    $('#main').innerHTML = '<form class="card gate" id="gate"><h2>' + (S.gateTeacher ? '교사 코드' : '입장 코드') + '</h2><p class="msg" style="margin:0">' + (S.gateTeacher ? '교사 코드를 입력하세요.' : '선생님이 알려준 코드를 입력하세요.') + '</p>' +
      '<input type="password" id="code" autocomplete="off" aria-label="코드"><button class="btn main" type="submit">들어가기</button>' + (S.gateTeacher ? '<button class="btn" type="button" data-act="cancel">취소</button>' : '') + '<p class="msg err" id="gerr" style="margin:0">' + esc(S.err) + '</p></form>';
  }
  function pickHtml() {
    var cl = classes(), first = cl[0];
    var opts = S.students.filter(function (s) { return s.cls === first; }).map(function (s) { return '<option value="' + s.no + '">' + s.no + '번 ' + esc(s.name) + '</option>'; }).join('');
    return '<div class="card"><h2>나는 누구인가요?</h2><p class="msg" style="margin:0">점수를 입력한 사람이 기록에 남습니다.</p><div class="bar">' +
      '<select id="wc" aria-label="반">' + cl.map(function (c) { return '<option value="' + c + '">' + c + '반</option>'; }).join('') + '</select>' +
      '<select id="wn" aria-label="번호와 이름">' + opts + '</select><button class="btn main" data-act="whook">확인</button></div></div>';
  }
  function adminHtml() {
    var c = S.cfg, cls = S.cls, n = S.students.filter(function (s) { return s.cls === cls; }).length, g = S.groups[cls] || [];
    var sel = function (k, opts) { return '<select data-cf="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(c[k]) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
    return '<div class="card"><h2>설정</h2><div class="set-grid">' +
      '<label class="f">방식' + sel('mode', [['single', '단식 (개인)'], ['double', '복식 (2인 1팀)']]) + '</label>' +
      '<label class="f">조 크기' + sel('size', [3, 4, 5, 6, 7, 8].map(function (v) { return [v, v]; })) + '</label>' +
      '<label class="f">경기 방식' + sel('sets', [[1, '1세트 점수제'], [3, '3세트']]) + '</label>' +
      '<label class="f">승점 (승)<input type="number" data-cf="win" value="' + c.win + '"></label>' +
      '<label class="f">승점 (무)<input type="number" data-cf="draw" value="' + c.draw + '"></label>' +
      '<label class="f">승점 (패)<input type="number" data-cf="loss" value="' + c.loss + '"></label></div>' +
      '<p class="msg" style="margin:0">설정을 바꾸면 모든 학생 화면에 바로 적용됩니다. 방식과 조 크기는 조 편성을 다시 해야 반영됩니다.</p></div>' +
      '<div class="card"><h2>' + cls + '반 조 편성</h2><p class="msg" style="margin:0">' + cls + '반 ' + n + '명, 현재 ' + g.length + '개 조.</p>' +
      '<div class="bar"><select id="assign" aria-label="편성 방법"><option value="snake">번호순으로 고르게</option><option value="random">무작위</option></select>' +
      '<button class="btn warn" data-act="build">' + (S.armed === 'build' ? '정말 편성 (점수 삭제)' : (g.length ? '조 다시 편성' : '조 편성하기')) + '</button></div>' +
      '<p class="msg" style="margin:0">다시 편성하면 이 반의 점수가 모두 지워집니다.</p></div>' +
      '<div class="card"><h2>점수 확정</h2><p class="msg" style="margin:0">확정한 경기는 학생이 고칠 수 없습니다. 개별 경기는 시트의 Scores 탭 확정 칸에서도 바꿀 수 있습니다.</p>' +
      '<div class="bar"><button class="btn" data-act="lockall">' + cls + '반 점수 전체 확정</button><button class="btn" data-act="unlockall">확정 해제</button><span class="msg" id="lockmsg"></span></div></div>' +
      '<p class="msg">학생 명렬 수정과 코드 변경은 구글 시트의 Students, Config 탭에서 합니다.</p>';
  }

  /* ---------- 조 편성 ---------- */
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildGroups(cls, assign) {
    var list = S.students.filter(function (s) { return s.cls === cls; }).sort(function (a, b) { return a.no - b.no; });
    var entries = [];
    if (S.cfg.mode === 'double') {
      var p = assign === 'random' ? shuffle(list.slice()) : list;
      for (var i = 0; i < p.length; i += 2) entries.push({ id: entries.length, members: p.slice(i, i + 2).map(function (s) { return s.no; }) });
    } else entries = list.map(function (s, i) { return { id: i, members: [s.no] }; });
    var k = Math.max(1, Math.ceil(entries.length / S.cfg.size)), groups = [];
    for (var q = 0; q < k; q++) groups.push([]);
    var order = assign === 'random' ? shuffle(entries.slice()) : entries;
    order.forEach(function (e, i) { var r = Math.floor(i / k); groups[r % 2 === 0 ? i % k : k - 1 - (i % k)].push(e.id); });
    groups.forEach(function (g) { g.sort(function (a, b) { return a - b; }); });
    return { entries: entries, groups: groups };
  }

  /* ---------- 저장 ---------- */
  function queueSave(cls, key) {
    var id = cls + '|' + key; pending[id] = true; clearTimeout(timers[id]);
    S.status = '저장 중…'; setStatus();
    timers[id] = setTimeout(function () { doSave(cls, key); }, 600);
  }
  function doSave(cls, key) {
    var id = cls + '|' + key, rec = S.scores[id];
    api('saveScore', { cls: cls, key: key, sets: rec.sets, who: whoStr() }).then(function () {
      delete pending[id];
      var d = new Date(); S.status = '저장됨 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); setStatus();
    }).catch(function (e) {
      if (e.code === 'locked') { delete pending[id]; S.status = e.message; refresh(true).catch(function () {}); return; }
      if (e.code === 'bad_code') { logout(); return; }
      S.status = '저장 실패: ' + e.message + ' (5초 뒤 다시 시도)'; setStatus();
      timers[id] = setTimeout(function () { doSave(cls, key); }, 5000);
    });
  }
  function logout() { ls.del(P + 'code'); S.code = ''; S.role = ''; S.err = ''; S.gateTeacher = false; start(); }
  function start() {
    var tries = S.code ? [S.code, ''] : [''];
    (function next(i) {
      S.code = tries[i];
      api('load').then(function (j) { if (S.code) ls.set(P + 'code', S.code); S.err = ''; apply(j); render(); })
        .catch(function (er) {
          if (er.code === 'bad_code' && i + 1 < tries.length) return next(i + 1);
          S.code = ''; ls.del(P + 'code'); S.gateTeacher = false;
          S.err = er.code === 'bad_code' ? '' : '불러오지 못했습니다: ' + er.message; render();
        });
    })(0);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'gate') return;
    e.preventDefault();
    S.code = $('#code').value.trim();
    api('load').then(function (j) {
      if (S.gateTeacher && j.role !== 'admin') { S.err = '교사 코드가 맞지 않습니다.'; S.code = ''; renderGate(); return; }
      ls.set(P + 'code', S.code); S.err = ''; S.gateTeacher = false; apply(j); render();
    }).catch(function (er) { S.err = er.code === 'bad_code' ? '코드가 맞지 않습니다.' : '불러오지 못했습니다: ' + er.message; S.code = ''; renderGate(); });
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.cls) { S.cls = +t.dataset.cls; S.armed = null; }
    else if (t.dataset.view) { S.view = t.dataset.view; S.armed = null; }
    else if (t.dataset.act === 'logout') { logout(); return; }
    else if (t.dataset.act === 'teacher') { S.gateTeacher = true; S.role = ''; S.code = ''; S.err = ''; }
    else if (t.dataset.act === 'cancel') { S.gateTeacher = false; S.err = ''; start(); return; }
    else if (t.dataset.act === 'repick') S.pick = true;
    else if (t.dataset.act === 'whook') {
      var c = +$('#wc').value, n = +$('#wn').value, s = stu(c, n);
      if (!s) return; S.who = { cls: c, no: n, name: s.name }; S.pick = false; ls.set(P + 'who', JSON.stringify(S.who));
    }
    else if (t.dataset.act === 'build') {
      if (S.armed !== 'build') { S.armed = 'build'; render(); return; }
      S.armed = null; var b = buildGroups(S.cls, $('#assign').value);
      S.status = '저장 중…'; setStatus();
      api('saveGroups', { cls: S.cls, entries: b.entries, groups: b.groups }).then(function () { S.status = '조 편성을 저장했습니다.'; return refresh(true); })
        .catch(function (er) { S.status = '저장 실패: ' + er.message; render(); });
      return;
    }
    else if (t.dataset.act === 'lockall' || t.dataset.act === 'unlockall') {
      api('setLock', { cls: S.cls, locked: t.dataset.act === 'lockall' }).then(function (j) { S.status = S.cls + '반 ' + j.count + '경기를 ' + (t.dataset.act === 'lockall' ? '확정' : '해제') + '했습니다.'; return refresh(true); })
        .catch(function (er) { S.status = '실패: ' + er.message; setStatus(); });
      return;
    }
    else return;
    render();
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'wc') {
      $('#wn').innerHTML = S.students.filter(function (s) { return s.cls === +el.value; }).map(function (s) { return '<option value="' + s.no + '">' + s.no + '번 ' + esc(s.name) + '</option>'; }).join('');
      return;
    }
    if (el.dataset.cf) {
      var v = {}; v[el.dataset.cf] = el.value; S.cfg[el.dataset.cf] = el.type === 'number' || /^\d+$/.test(el.value) ? +el.value : el.value;
      api('saveConfig', { values: v }).then(function () { S.status = '설정을 저장했습니다.'; setStatus(); }).catch(function (er) { S.status = '저장 실패: ' + er.message; setStatus(); });
    }
  });
  document.addEventListener('input', function (e) {
    var el = e.target; if (!el.dataset || !el.dataset.k) return;
    var cls = S.cls, key = el.dataset.k, i = +el.dataset.i, s = +el.dataset.s, id = cls + '|' + key;
    var rec = S.scores[id] || (S.scores[id] = { sets: [], locked: false });
    while (rec.sets.length < 3) rec.sets.push(['', '']);
    rec.sets[i] = rec.sets[i].slice(); rec.sets[i][s] = el.value === '' ? '' : Math.max(0, Math.min(99, Math.floor(+el.value)));
    var row = el.closest('.match'), gi = +row.dataset.g, r = result(rec.sets);
    row.children[0].classList.toggle('win', !!r && r.w === 'a'); row.children[2].classList.toggle('win', !!r && r.w === 'b');
    row.closest('[data-card]').querySelector('.st').innerHTML = standHtml(cls, gi);
    var pr = progress(cls); document.querySelector('.prog').textContent = cls + '반 진행 ' + pr[0] + ' / ' + pr[1] + '경기';
    queueSave(cls, key);
  });

  /* ---------- 시작 ---------- */
  setInterval(function () { if (S.role && !document.hidden) refresh(false).catch(function () {}); }, 30000);
  $('#title').textContent = C.title;
  start();
})();
