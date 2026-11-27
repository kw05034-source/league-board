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
  var S = { draft: {}, open: {}, late: {}, editStu: null, opt: { assign: 'snake', split: '0', km: '1', kf: '1', ka: '1' }, code: ls.get(P + 'code') || '', role: '', cfg: {}, students: [], entries: {}, groups: {}, scores: {},
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
    S.entries = {}; S.groups = {}; S.late = {};
    var rows = j.groups.slice().sort(function (a, b) { return a.cls - b.cls || a.group - b.group || a.entry - b.entry; });
    rows.forEach(function (g) {
      var m = String(g.members).trim().split(/\s+/).filter(Boolean).map(function (n) { return stu(g.cls, +n); }).filter(Boolean);
      (S.entries[g.cls] = S.entries[g.cls] || {})[g.entry] = { id: g.entry, m: m };
      if (g.late) (S.late[g.cls] = S.late[g.cls] || {})[g.entry] = true;
      var arr = (S.groups[g.cls] = S.groups[g.cls] || []);
      (arr[g.group - 1] = arr[g.group - 1] || []).push(g.entry);
    });
    var sc = {};
    j.scores.forEach(function (r) {
      var id = r.cls + '|' + r.key;
      sc[id] = pending[id] && S.scores[id] ? S.scores[id] : { sets: r.sets, locked: r.locked, by: r.by, at: r.at };
    });
    Object.keys(pending).forEach(function (id) { if (!sc[id] && S.scores[id]) sc[id] = S.scores[id]; });
    Object.keys(S.scores).forEach(function (id) {
      var l = S.scores[id]; if (!l || !l.keep || l.keep < Date.now()) return;
      var s = sc[id]; if (!s || !l.at || s.at < l.at) sc[id] = l;
    });
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
      var before = JSON.stringify([S.groups, S.scores, S.cfg, S.students, S.late]);
      apply(j);
      var after = JSON.stringify([S.groups, S.scores, S.cfg, S.students, S.late]);
      var typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.match');
      if (force || (before !== after && !typing)) render();
    });
  }

  /* ---------- 경기 계산 ---------- */
  function schedule(ids, cls) {
    var late = (S.late && S.late[cls]) || {}, base = ids.filter(function (i) { return !late[i]; }), extra = [];
    ids.forEach(function (id, i) { if (late[id]) for (var j = 0; j < i; j++) extra.push([ids[j], id]); });
    var rounds = circle(base);
    if (extra.length) { extra.extra = true; rounds.push(extra); }
    return rounds;
  }
  function circle(ids) {
    var a = ids.slice(); if (a.length % 2) a.push(null);
    var n = a.length, rounds = [];
    for (var r = 0; r < n - 1; r++) {
      var ms = [];
      for (var i = 0; i < n / 2; i++) { var x = a[i], y = a[n - 1 - i]; if (x !== null && y !== null) ms.push([x, y]); }
      rounds.push(ms); a.splice(1, 0, a.pop());
    }
    return rounds;
  }
  function gone(cls, id) { var e = S.entries[cls] && S.entries[cls][id]; return !!(e && e.m.some(function (s) { return s.out; })); }
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
    ids.forEach(function (id) { if (gone(cls, id)) return; rows[id] = { id: id, p: 0, w: 0, d: 0, l: 0, pt: 0, sf: 0, sa: 0, pf: 0, pa: 0 }; });
    schedule(ids, cls).forEach(function (rd) { rd.forEach(function (m) {
      var x = m[0], y = m[1]; if (gone(cls, x) || gone(cls, y)) return; var r = result(setsOf(cls, x + '-' + y)); if (!r) return;
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
    (S.groups[cls] || []).forEach(function (g) { schedule(g, cls).forEach(function (rd) { rd.forEach(function (m) {
      if (gone(cls, m[0]) || gone(cls, m[1])) return;
      t++; if (result(setsOf(cls, m[0] + '-' + m[1]))) d++; }); }); });
    return [d, t];
  }

  /* ---------- 화면 조각 ---------- */
  function label(e) { return e.m.map(function (s) { return '<span class="no">' + s.no + '</span>' + esc(s.name); }).join(' · '); }
  function standHtml(cls, gi) {
    var rows = standings(cls, gi), any = rows.some(function (r) { return r.p; }), ent = S.entries[cls], ns = S.cfg.sets !== 1;
    return '<div class="tbl"><table><thead><tr><th>순위</th><th class="nm">이름</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승점</th>' + (ns ? '<th>세트</th>' : '') + '<th>득실</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var d = r.pf - r.pa;
        return '<tr class="' + (i === 0 && any ? 'first' : '') + '"><td class="rank">' + (any ? i + 1 : '-') + '</td><td class="nm">' + label(ent[r.id]) + '</td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td><b>' + r.pt + '</b></td>' + (ns ? '<td>' + r.sf + ':' + r.sa + '</td>' : '') + '<td>' + (d > 0 ? '+' : '') + d + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function matrixHtml(cls, gi) {
    var ids = S.groups[cls][gi].filter(function (id) { return !gone(cls, id); }), ent = S.entries[cls], map = {}, played = {};
    ids.forEach(function (id) { map[id] = {}; });
    schedule(S.groups[cls][gi], cls).forEach(function (rd) { rd.forEach(function (m) {
      var x = m[0], y = m[1]; if (!map[x] || !map[y]) return;
      var r = result(setsOf(cls, x + '-' + y)); if (!r) return;
      var sx = r.pa + ':' + r.pb, sy = r.pb + ':' + r.pa;
      map[x][y] = { t: r.w === 'a' ? '승' : r.w === 'b' ? '패' : '무', s: sx };
      map[y][x] = { t: r.w === 'b' ? '승' : r.w === 'a' ? '패' : '무', s: sy };
    }); });
    var nums = function (id) { return ent[id].m.map(function (s) { return s.no; }).join('·'); };
    var me = null;
    if (S.who && S.who.cls === cls) ids.forEach(function (id) { if (ent[id].m.some(function (s) { return s.no === S.who.no; })) me = id; });
    var strip = '';
    if (me !== null) {
      var w = 0, l = 0, d = 0, left = [];
      ids.forEach(function (o) { if (o === me) return; var c = map[me][o]; if (!c) left.push(label(ent[o])); else if (c.t === '승') w++; else if (c.t === '패') l++; else d++; });
      strip = '<div class="mine"><b>내 현황</b> ' + w + '승 ' + l + '패' + (d ? ' ' + d + '무' : '') + ' · 아직 안 한 상대 ' + left.length + '명' +
        (left.length ? '<div class="chips">' + left.map(function (n) { return '<span>' + n + '</span>'; }).join('') + '</div>' : ' 🎉 모두 끝냈어요') + '</div>';
    }
    return strip + '<h3 class="mxh">대진표 <small>칸이 비어 있으면 아직 안 한 경기예요</small></h3><div class="tbl mx"><table><thead><tr><th class="nm">이름</th>' +
      ids.map(function (c) { return '<th class="' + (c === me ? 'me' : '') + '" title="' + esc(ent[c].m.map(function (s) { return s.name; }).join(' · ')) + '">' + nums(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + ids.map(function (r) {
        return '<tr class="' + (r === me ? 'me' : '') + '"><td class="nm">' + label(ent[r]) + '</td>' + ids.map(function (c) {
          if (c === r) return '<td class="self"></td>';
          var x = map[r][c];
          return x ? '<td class="res ' + (x.t === '승' ? 'w' : x.t === '패' ? 'l' : 'd') + '" title="' + x.s + '">' + x.t + '</td>' : '<td class="res"></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function hasScore(sets) {
    return (sets || []).some(function (t) { return t && ((t[0] !== '' && t[0] != null) || (t[1] !== '' && t[1] != null)); });
  }
  function matchHtml(cls, gi, x, y) {
    var key = x + '-' + y, id = cls + '|' + key, rec = S.scores[id], saved = rec ? rec.sets : [], n = S.cfg.sets, r = result(saved);
    var has = hasScore(saved), draft = S.draft[id], editing = !!draft || !has, sets = draft || saved;
    var locked = rec && rec.locked && S.role !== 'admin', ent = S.entries[cls], inputs = '', off = (locked || !editing) ? ' disabled' : '';
    for (var i = 0; i < n; i++) {
      var s = sets[i] || ['', ''], pre = n > 1 ? (i + 1) + '세트 ' : '';
      inputs += '<div class="set">' + (n > 1 ? '<span>' + (i + 1) + '세트</span>' : '') +
        '<input type="number" inputmode="numeric" min="0" max="99" aria-label="' + pre + '왼쪽 점수" data-k="' + key + '" data-i="' + i + '" data-s="0" value="' + s[0] + '"' + off + '>' +
        '<span>:</span>' +
        '<input type="number" inputmode="numeric" min="0" max="99" aria-label="' + pre + '오른쪽 점수" data-k="' + key + '" data-i="' + i + '" data-s="1" value="' + s[1] + '"' + off + '></div>';
    }
    var tags = (n > 1 && r ? '<span class="tag done">' + r.wa + ' : ' + r.wb + '</span>' : '') + (rec && rec.locked ? '<span class="tag lock">확정</span>' : '');
    var btns = '';
    if (!locked) {
      btns = editing
        ? '<div class="acts"><button class="btn main" data-act="ok" data-k="' + key + '">확인</button>' + (has ? '<button class="btn" data-act="cancelEdit" data-k="' + key + '">취소</button>' : '') + '</div>'
        : '<div class="acts"><button class="btn" data-act="edit" data-k="' + key + '">수정</button></div>';
    }
    return '<div class="match" data-g="' + gi + '" data-k="' + key + '"><div class="side ' + (r && r.w === 'a' ? 'win' : '') + '">' + label(ent[x]) + '</div><div class="sc">' + inputs + tags + btns + '</div><div class="side r ' + (r && r.w === 'b' ? 'win' : '') + '">' + label(ent[y]) + '</div></div>';
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
      m.innerHTML = head + '<div class="groups">' + g.map(function (_, gi) { return '<div class="card"><h2>' + gName(S.cls, gi) + '</h2>' + standHtml(S.cls, gi) + matrixHtml(S.cls, gi) + '</div>'; }).join('') + '</div>';
      return;
    }
    m.innerHTML = head + '<div class="groups">' + g.map(function (ids, gi) {
      var firstOpen = false;
      return '<div class="card" data-card="' + gi + '"><h2>' + gName(S.cls, gi) + '</h2>' +
        schedule(ids, S.cls).map(function (rd0, ri) {
          var rd = rd0.filter(function (mm) { return !gone(S.cls, mm[0]) && !gone(S.cls, mm[1]); }); rd.extra = rd0.extra;
          if (!rd.length) return '';
          var k = S.cls + '|' + gi + '|' + ri, done = rd.filter(function (mm) { return result(setsOf(S.cls, mm[0] + '-' + mm[1])); }).length;
          if (S.open[k] === undefined) { S.open[k] = !firstOpen && done < rd.length; if (S.open[k]) firstOpen = true; }
          else if (S.open[k] && done < rd.length) firstOpen = true;
          return '<details class="rd' + (done === rd.length ? ' alldone' : '') + '" data-ok="' + k + '"' + (S.open[k] ? ' open' : '') + '><summary><span class="round">' + (rd.extra ? '전학생 경기' : (ri + 1) + '라운드') + '</span><span class="rcount">' + done + ' / ' + rd.length + ' 완료</span></summary>' +
            rd.map(function (mm) { return matchHtml(S.cls, gi, mm[0], mm[1]); }).join('') + '</details>';
        }).join('') + '</div>';
    }).join('') + '</div>';
  }
  function renderGate() {
    $('#sub').textContent = ''; $('#clsBar').innerHTML = ''; $('#viewBar').innerHTML = ''; $('#banner').innerHTML = '';
    $('#main').innerHTML = '<form class="card gate" id="gate"><h2>' + (S.gateTeacher ? '교사 코드' : '입장 코드') + '</h2><p class="msg" style="margin:0">' + (S.gateTeacher ? '교사 코드를 입력하세요.' : '선생님이 알려준 코드를 입력하세요.') + '</p>' +
      '<input type="password" id="code" autocomplete="off" aria-label="코드"><button class="btn main" type="submit">들어가기</button>' + (S.gateTeacher ? '<button class="btn" type="button" data-act="cancel">취소</button>' : '') + '<p class="msg err" id="gerr" style="margin:0">' + esc(S.err) + '</p></form>';
  }
  function pickHtml() {
    var cl = classes(), first = cl[0];
    var opts = S.students.filter(function (s) { return s.cls === first && !s.out; }).map(function (s) { return '<option value="' + s.no + '">' + s.no + '번 ' + esc(s.name) + '</option>'; }).join('');
    return '<div class="card"><h2>나는 누구인가요?</h2><p class="msg" style="margin:0">점수를 입력한 사람이 기록에 남습니다.</p><div class="bar">' +
      '<select id="wc" aria-label="반">' + cl.map(function (c) { return '<option value="' + c + '">' + c + '반</option>'; }).join('') + '</select>' +
      '<select id="wn" aria-label="번호와 이름">' + opts + '</select><button class="btn main" data-act="whook">확인</button></div></div>';
  }
  /* 그 반에서 양쪽 모두 해당 성별인 경기의 입력된 점수 개수 */
  function sexScoreCount(cls, sex) {
    var ent = S.entries[cls] || {}, n = 0;
    Object.keys(S.scores).forEach(function (id) {
      if (id.split('|')[0] !== String(cls)) return;
      var k = id.split('|')[1].split('-'), a = ent[k[0]], b = ent[k[1]];
      if (!a || !b || !result(S.scores[id].sets || [])) return;
      var all = function (e) { return e.m.length > 0 && e.m.every(function (s) { return s.sex === sex; }); };
      if (all(a) && all(b)) n++;
    });
    return n;
  }
  function adminHtml() {
    var c = S.cfg, cls = S.cls, n = S.students.filter(function (s) { return s.cls === cls && !s.out; }).length, g = S.groups[cls] || [], done = progress(cls)[0];
    var sel = function (k, opts) { return '<select data-cf="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(c[k]) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
    return '<div class="card"><h2>설정</h2><div class="set-grid">' +
      '<label class="f">방식' + sel('mode', [['single', '단식 (개인)'], ['double', '복식 (2인 1팀)']]) + '</label>' +
      '<label class="f">경기 방식' + sel('sets', [[1, '1세트 점수제'], [3, '3세트']]) + '</label>' +
      '<label class="f">승점 (승)<input type="number" data-cf="win" value="' + c.win + '"></label>' +
      '<label class="f">승점 (무)<input type="number" data-cf="draw" value="' + c.draw + '"></label>' +
      '<label class="f">승점 (패)<input type="number" data-cf="loss" value="' + c.loss + '"></label></div>' +
      '<p class="msg" style="margin:0">설정을 바꾸면 모든 학생 화면에 바로 적용됩니다. 방식은 조 편성을 다시 해야 반영됩니다.</p></div>' +
      '<div class="card"><h2>' + cls + '반 조 편성</h2><p class="msg" style="margin:0">' + cls + '반 ' + n + '명, 현재 ' + g.length + '개 조.</p>' +
      '<div class="bar"><select id="assign" aria-label="편성 방법"><option value="snake"' + (S.opt.assign === 'snake' ? ' selected' : '') + '>번호순으로 고르게</option><option value="random"' + (S.opt.assign === 'random' ? ' selected' : '') + '>무작위</option></select>' +
      '<select id="split" aria-label="성별"><option value="0"' + (S.opt.split === '0' ? ' selected' : '') + '>남녀 같이</option><option value="1"' + (S.opt.split === '1' ? ' selected' : '') + '>남녀 따로</option></select>' +
      '<button class="btn warn" data-act="build">' + (S.armed === 'build' ? (done ? '정말 편성 (점수 ' + done + '개 삭제)' : '정말 편성') : (g.length ? '조 다시 편성' : '조 편성하기')) + '</button></div>' +
      '<div class="bar">' + (S.opt.split === '1'
        ? '<label class="f">남 조 수<input type="number" id="km" min="1" max="30" style="width:72px" value="' + esc(S.opt.km) + '"></label><label class="f">여 조 수<input type="number" id="kf" min="1" max="30" style="width:72px" value="' + esc(S.opt.kf) + '"></label>'
        : '<label class="f">조 수<input type="number" id="ka" min="1" max="30" style="width:72px" value="' + esc(S.opt.ka) + '"></label>') + '</div>' +
      '<p class="msg" style="margin:0">조 수를 1로 하면 전원이 한 조(풀리그)입니다. 한 조는 최소 2명이 되도록 자동으로 줄입니다.</p>' +
      '<p class="msg' + (done ? ' err' : '') + '" style="margin:0">' + (done ? '이 반에 입력된 점수가 ' + done + '개 있습니다. 다시 편성하면 화면에서는 지워지고, 구글 시트의 Backup 탭에 보관됩니다.' : '다시 편성하면 이 반의 점수가 지워집니다.') + ' 확정된 경기가 있으면 먼저 확정을 풀어야 합니다.</p></div>' +
      '<div class="card"><h2>' + cls + '반 점수 초기화</h2><p class="msg" style="margin:0">조 편성은 그대로 두고, 한 성별의 경기 점수만 지웁니다. 지운 점수는 구글 시트의 Backup 탭에 보관됩니다.</p>' +
      '<div class="bar">' + ['남', '여'].map(function (x) { var k = sexScoreCount(cls, x); return '<button class="btn' + (S.armed === 'clr:' + x ? ' danger' : '') + '" data-act="clr" data-sex="' + x + '"' + (k ? '' : ' disabled') + '>' + (S.armed === 'clr:' + x ? '정말 ' + x + ' 점수 ' + k + '개 지우기' : x + '자 점수 초기화 (' + k + '개)') + '</button>'; }).join('') + '</div>' +
      '<p class="msg" style="margin:0">남녀 같이 편성한 조에서 남녀가 맞붙은 경기는 어느 쪽에도 속하지 않아 지워지지 않습니다. 확정된 경기가 있으면 먼저 확정을 풀어야 합니다.</p></div>' +
      '<div class="card"><h2>학생 명단 관리</h2><details class="rd" data-ok="roster|' + cls + '"' + (S.open['roster|' + cls] ? ' open' : '') + '><summary><span class="round">' + cls + '반 ' + S.students.filter(function (s) { return s.cls === cls; }).length + '명 보기</span></summary>' +
      S.students.filter(function (s) { return s.cls === cls; }).sort(function (a, b) { return a.no - b.no; }).map(function (s) {
        if (S.editStu === cls + '|' + s.no) return '<div class="srow edit"><span class="sno">' + s.no + '</span><input type="text" id="es-name" maxlength="20" value="' + esc(s.name) + '" autocomplete="off"><select id="es-sex"><option value="남"' + (s.sex === '남' ? ' selected' : '') + '>남</option><option value="여"' + (s.sex === '여' ? ' selected' : '') + '>여</option></select><button class="btn main" data-act="stusave" data-no="' + s.no + '">저장</button><button class="btn" data-act="stucancel">취소</button></div>';
        return '<div class="srow' + (s.out ? ' out' : '') + '"><span class="sno">' + s.no + '</span><span class="snm">' + esc(s.name) + (s.out ? ' <em>전출</em>' : '') + '</span><span class="ssx">' + esc(s.sex) + '</span>' +
          (s.out ? '<button class="btn" data-act="stuback" data-no="' + s.no + '">전출 취소</button>' :
            '<button class="btn" data-act="stuedit" data-no="' + s.no + '">수정</button><button class="btn' + (S.armed === 'out:' + s.no ? ' danger' : '') + '" data-act="stuout" data-no="' + s.no + '">' + (S.armed === 'out:' + s.no ? '정말 전출' : '전출') + '</button>') + '</div>';
      }).join('') + '</details>' +
      '<p class="msg" style="margin:0">이름·성별은 고칠 수 있고, 번호는 바꾸지 않습니다. 전출 처리하면 그 학생의 경기는 화면과 순위에서 빠지지만 점수 기록은 시트에 남습니다(취소하면 되돌아옵니다).</p></div>' +
      '<div class="card"><h2>전학생 추가</h2><p class="msg" style="margin:0">' + cls + '반에 새 학생을 추가합니다. 이름은 구글 시트 Students 탭에 저장됩니다.</p>' +
      '<div class="set-grid"><label class="f">번호 (비우면 자동)<input type="number" id="ns-no" min="1" max="99" inputmode="numeric"></label>' +
      '<label class="f">이름<input type="text" id="ns-name" maxlength="20" autocomplete="off"></label>' +
      '<label class="f">성별<select id="ns-sex"><option value="남">남</option><option value="여">여</option></select></label>' +
      '<label class="f">들어갈 조<select id="ns-g"><option value="0">조에 넣지 않음</option>' + g.map(function (_, gi) { return '<option value="' + (gi + 1) + '">' + gName(cls, gi) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="bar"><button class="btn main" data-act="addstu">추가</button></div>' +
      '<p class="msg" style="margin:0">조에 넣으면 그 조 사람들과의 경기가 \'전학생 경기\'로 따로 생깁니다. 이미 입력된 점수와 라운드는 그대로입니다. 조에 넣지 않으면 다음 조 편성 때 포함됩니다.</p></div>' +
      '<div class="card"><h2>점수 확정</h2><p class="msg" style="margin:0">확정한 경기는 학생이 고칠 수 없습니다. 개별 경기는 시트의 Scores 탭 확정 칸에서도 바꿀 수 있습니다.</p>' +
      '<div class="bar"><button class="btn" data-act="lockall">' + cls + '반 점수 전체 확정</button><button class="btn" data-act="unlockall">확정 해제</button><span class="msg" id="lockmsg"></span></div></div>' +
      '<p class="msg">학생 명렬 수정과 코드 변경은 구글 시트의 Students, Config 탭에서 합니다.</p>';
  }

  function readOpt() {
    var g = function (id, d) { var e = $(id); return e ? e.value : d; };
    S.opt = { assign: g('#assign', S.opt.assign), split: g('#split', S.opt.split), km: g('#km', S.opt.km), kf: g('#kf', S.opt.kf), ka: g('#ka', S.opt.ka) };
  }
  /* ---------- 조 편성 ---------- */
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildGroups(cls, assign, split, kcount) {
    var list = S.students.filter(function (s) { return s.cls === cls && !s.out; }).sort(function (a, b) { return a.no - b.no; });
    var parts = [list]; kcount = kcount || {};
    if (split) {
      var seen = [], by = {};
      ['남', '여'].forEach(function (x) { seen.push(x); });
      list.forEach(function (s) { if (seen.indexOf(s.sex) < 0) seen.push(s.sex); (by[s.sex] = by[s.sex] || []).push(s); });
      parts = seen.map(function (x) { return by[x] || []; }).filter(function (p) { return p.length; });
    }
    var entries = [], groups = [];
    parts.forEach(function (part) {
      var mine = [];
      if (S.cfg.mode === 'double') {
        var p = assign === 'random' ? shuffle(part.slice()) : part;
        for (var i = 0; i < p.length; i += 2) { var e = { id: entries.length, members: p.slice(i, i + 2).map(function (s) { return s.no; }) }; entries.push(e); mine.push(e); }
      } else part.forEach(function (s) { var e = { id: entries.length, members: [s.no] }; entries.push(e); mine.push(e); });
      var kk = Math.floor(kcount[split && part.length ? part[0].sex : '*']) || 1;
      var k = Math.max(1, Math.min(kk, Math.floor(mine.length / 2))), gs = [];
      for (var q = 0; q < k; q++) gs.push([]);
      var order = assign === 'random' ? shuffle(mine.slice()) : mine;
      order.forEach(function (e, i) { var r = Math.floor(i / k); gs[r % 2 === 0 ? i % k : k - 1 - (i % k)].push(e.id); });
      gs.forEach(function (g) { g.sort(function (a, b) { return a - b; }); groups.push(g); });
    });
    return { entries: entries, groups: groups };
  }
  /* 한 조가 모두 같은 성별이고 조들이 성별로 나뉘어 있으면 "남 1조", "여 1조"로 보여 줍니다. */
  function gName(cls, gi) {
    var gs = S.groups[cls] || [], ent = S.entries[cls] || {};
    var sx = gs.map(function (ids) {
      var set = {}; ids.forEach(function (id) { if (ent[id]) ent[id].m.forEach(function (s) { set[s.sex] = 1; }); });
      var k = Object.keys(set); return k.length === 1 ? k[0] : '';
    });
    if (sx.some(function (x) { return !x; }) || sx.every(function (x) { return x === sx[0]; })) return (gi + 1) + '조';
    var n = 0; for (var i = 0; i <= gi; i++) if (sx[i] === sx[gi]) n++;
    return sx[gi] + ' ' + n + '조';
  }

  /* ---------- 저장 ---------- */
  function confirmScore(cls, key) {
    var id = cls + '|' + key, d = (S.draft[id] || []).slice(), n = S.cfg.sets, sets = [], any = false;
    for (var i = 0; i < 3; i++) {
      var t = d[i] || ['', ''], a = t[0], b = t[1], ea = a === '' || a == null, eb = b === '' || b == null;
      if (i < n && ea !== eb) { S.status = '점수는 양쪽 모두 입력하세요.'; setStatus(); return; }
      if (i < n && !ea && !eb && +a === 0 && +b === 0) { S.status = '0대0은 입력할 수 없습니다.'; setStatus(); return; }
      if (!ea && !eb) any = true;
      sets.push(i < n ? [ea ? '' : a, eb ? '' : b] : ['', '']);
    }
    var rec = S.scores[id] || { sets: [], locked: false };
    if (!any && !hasScore(rec.sets) && !S.draft[id]) { S.status = '점수를 입력하세요.'; setStatus(); return; }
    S.scores[id] = { sets: sets, locked: rec.locked, by: whoStr(), at: rec.at, keep: Date.now() + 90000 };
    delete S.draft[id];
    pending[id] = true; clearTimeout(timers[id]); S.status = '저장 중…';
    doSave(cls, key);
    render();
  }
  function doSave(cls, key) {
    var id = cls + '|' + key, rec = S.scores[id];
    api('saveScore', { cls: cls, key: key, sets: rec.sets, who: whoStr() }).then(function (j) {
      delete pending[id]; if (S.scores[id] && j && j.at) S.scores[id].at = j.at;
      var d = new Date(); S.status = '저장됨 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); setStatus();
    }).catch(function (e) {
      if (e.code === 'zero') { delete pending[id]; delete S.scores[id]; S.status = e.message; refresh(true).catch(function () {}); return; }
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
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.dataset && d.dataset.ok) S.open[d.dataset.ok] = d.open; }, true);
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
    else if (t.dataset.act === 'ok') { confirmScore(S.cls, t.dataset.k); return; }
    else if (t.dataset.act === 'edit') { var eid = S.cls + '|' + t.dataset.k, er = S.scores[eid]; S.draft[eid] = (er && er.sets ? er.sets : []).map(function (q) { return (q || ['', '']).slice(); }); S.status = ''; }
    else if (t.dataset.act === 'cancelEdit') { delete S.draft[S.cls + '|' + t.dataset.k]; S.status = ''; }
    else if (t.dataset.act === 'build') {
      if (S.armed !== 'build') { readOpt(); S.armed = 'build'; render(); return; }
      S.armed = null; S.draft = {}; S.open = {}; S.scores = {}; var b = buildGroups(S.cls, S.opt.assign, S.opt.split === '1', { '남': +S.opt.km || 1, '여': +S.opt.kf || 1, '*': +S.opt.ka || 1 });
      S.status = '저장 중…'; setStatus();
      api('saveGroups', { cls: S.cls, entries: b.entries, groups: b.groups }).then(function () { S.status = '조 편성을 저장했습니다.'; return refresh(true); })
        .catch(function (er) { S.status = '저장 실패: ' + er.message; render(); });
      return;
    }
    else if (t.dataset.act === 'clr') {
      var cx = t.dataset.sex;
      if (S.armed !== 'clr:' + cx) { S.armed = 'clr:' + cx; render(); return; }
      S.armed = null; S.status = '지우는 중…'; render();
      api('clearScores', { cls: S.cls, sex: cx })
        .then(function (j) { S.draft = {}; S.status = S.cls + '반 ' + cx + '자 점수 ' + (j.backed || 0) + '개를 지웠습니다(Backup 탭에 보관).'; S.scores = {}; return refresh(true); })
        .catch(function (er) { S.status = '초기화 실패: ' + er.message; render(); });
      return;
    }
    else if (t.dataset.act === 'stuedit') { S.editStu = S.cls + '|' + t.dataset.no; S.armed = null; S.open['roster|' + S.cls] = true; }
    else if (t.dataset.act === 'stucancel') { S.editStu = null; }
    else if (t.dataset.act === 'stusave') {
      var sn = +t.dataset.no, snm = $('#es-name').value.trim();
      if (!snm) { S.status = '이름을 입력하세요.'; setStatus(); return; }
      api('updateStudent', { cls: S.cls, no: sn, name: snm, sex: $('#es-sex').value })
        .then(function () { S.editStu = null; S.status = sn + '번 정보를 저장했습니다.'; return refresh(true); })
        .catch(function (er) { S.status = '저장 실패: ' + er.message; setStatus(); });
      return;
    }
    else if (t.dataset.act === 'stuout' || t.dataset.act === 'stuback') {
      var on = +t.dataset.no, isOut = t.dataset.act === 'stuout';
      if (isOut && S.armed !== 'out:' + on) { S.armed = 'out:' + on; render(); return; }
      S.armed = null;
      api('withdrawStudent', { cls: S.cls, no: on, out: isOut })
        .then(function () { S.status = on + '번 ' + (isOut ? '전출 처리했습니다.' : '전출을 취소했습니다.'); return refresh(true); })
        .catch(function (er) { S.status = '실패: ' + er.message; setStatus(); });
      return;
    }
    else if (t.dataset.act === 'addstu') {
      var nm = $('#ns-name').value.trim(), nno = $('#ns-no').value, gsel = +$('#ns-g').value, ncls = S.cls;
      if (!nm) { S.status = '이름을 입력하세요.'; setStatus(); return; }
      S.status = '추가 중…'; setStatus();
      api('addStudent', { cls: ncls, grade: C.grade, no: nno === '' ? 0 : +nno, name: nm, sex: $('#ns-sex').value, group: gsel })
        .then(function (j) { S.status = ncls + '반 ' + j.no + '번 ' + nm + ' 학생을 추가했습니다' + (j.group ? ' (' + gName(ncls, j.group - 1) + ')' : '') + '.'; return refresh(true); })
        .catch(function (er) { S.status = '추가 실패: ' + er.message; setStatus(); });
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
    if (el.id === 'split' || el.id === 'assign' || el.id === 'km' || el.id === 'kf' || el.id === 'ka') {
      var was = S.opt.split; readOpt(); if (S.opt.split !== was) render(); return;
    }
    if (el.id === 'wc') {
      $('#wn').innerHTML = S.students.filter(function (s) { return s.cls === +el.value && !s.out; }).map(function (s) { return '<option value="' + s.no + '">' + s.no + '번 ' + esc(s.name) + '</option>'; }).join('');
      return;
    }
    if (el.dataset.cf) {
      var v = {}; v[el.dataset.cf] = el.value; S.cfg[el.dataset.cf] = el.type === 'number' || /^\d+$/.test(el.value) ? +el.value : el.value;
      api('saveConfig', { values: v }).then(function () { S.status = '설정을 저장했습니다.'; setStatus(); }).catch(function (er) { S.status = '저장 실패: ' + er.message; setStatus(); });
    }
  });
  document.addEventListener('input', function (e) {
    var el = e.target; if (!el.dataset || !el.dataset.k) return;
    var cls = S.cls, key = el.dataset.k, i = +el.dataset.i, side = +el.dataset.s, id = cls + '|' + key;
    var d = S.draft[id];
    if (!d) { var sv = S.scores[id]; d = S.draft[id] = (sv && sv.sets ? sv.sets : []).map(function (q) { return (q || ['', '']).slice(); }); }
    while (d.length < 3) d.push(['', '']);
    d[i] = d[i].slice(); d[i][side] = el.value === '' ? '' : Math.max(0, Math.min(99, Math.floor(+el.value)));
  });

  /* ---------- 시작 ---------- */
  var lastPoll = Date.now();
  function poll(force) {
    if (!S.role || document.hidden) return;
    if (!force && Date.now() - lastPoll < (S.role === 'admin' ? 8000 : 20000)) return;
    lastPoll = Date.now(); refresh(false).catch(function () {});
  }
  setInterval(poll, 4000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(true); });
  window.addEventListener('focus', function () { poll(true); });
  document.addEventListener('focusout', function (e) { if (e.target && e.target.closest && e.target.closest('.match')) setTimeout(function () { poll(true); }, 400); });
  $('#title').textContent = C.title;
  start();
})();
