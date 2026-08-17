let QUESTIONS = [];

// ---------- safety ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- derived status ----------
function questionStatus(q) {
  const hasAnswer = Array.isArray(q.answer) && q.answer.length > 0;
  const hasExplanation = !!(q.explanation && q.explanation.trim());
  if (hasAnswer && hasExplanation) return 'good';
  if (hasAnswer && !hasExplanation) return 'warning';
  return 'critical'; // no answer at all (with or without explanation text)
}

const STATUS_LABEL = { good: '✅ 有詳解', warning: '🟡 只有答案', critical: '🔴 缺答案/詳解' };
// 原始命題紙上的題型代號：A type（單選）、AII type（圖片單選）、C type／K type（組合題）
const FORMAT_LABEL = { A: 'A type', A2: 'AII type', C: 'C type', K: 'K type' };
function formatLabel(q) { return FORMAT_LABEL[q.format] || q.format || ''; }

// ---------- combo-type (C-type / K-type) rule parsing ----------
// rule_text 例如 "(A) A only, (B) B only, (C) Both A and B, (D) Neither A and B"
// 或 "(A) if 1,2,3 are true, (B) if 1,3 are true, ..." -> 拆成可以直接讓使用者選的選項
function parseComboChoices(ruleText) {
  if (!ruleText) return [];
  const out = [];
  const re = /\(([A-Ea-e])\)\s*([^()]*?)(?=\s*\([A-Ea-e]\)|$)/g;
  let m;
  while ((m = re.exec(ruleText)) !== null) {
    const text = m[2].replace(/[,，]\s*$/, '').trim();
    if (text) out.push({ key: m[1].toUpperCase(), text });
  }
  return out;
}

// ---------- stats ----------
function renderStats() {
  const total = QUESTIONS.length;
  const good = QUESTIONS.filter(q => q._status === 'good').length;
  const warning = QUESTIONS.filter(q => q._status === 'warning').length;
  const critical = QUESTIONS.filter(q => q._status === 'critical').length;
  const subjects = new Set(QUESTIONS.map(q => q.subject)).size;

  const tiles = [
    { label: '總題數', dot: 'total', value: total },
    { label: '有詳解', dot: 'good', value: good },
    { label: '只有答案', dot: 'warning', value: warning },
    { label: '缺答案/詳解', dot: 'critical', value: critical },
    { label: '涵蓋科目數', dot: 'total', value: subjects },
  ];
  document.getElementById('statsRow').innerHTML = tiles.map(t => `
    <div class="stat-tile">
      <div class="label"><span class="dot ${t.dot}"></span>${escapeHtml(t.label)}</div>
      <div class="value">${t.value}</div>
    </div>
  `).join('');
}

// ---------- filter dropdowns ----------
function uniqueSorted(arr) { return [...new Set(arr)].sort((a,b)=>a.localeCompare(b,'zh-Hant')); }

function populateSubjectFilter(selectEl, includeAll = true) {
  const subjects = uniqueSorted(QUESTIONS.map(q => q.subject));
  selectEl.innerHTML = (includeAll ? '<option value="">全部科目</option>' : '') +
    subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function populateChapterFilter(subject) {
  const chapters = uniqueSorted(QUESTIONS.filter(q => !subject || q.subject === subject).map(q => q.chapter).filter(Boolean));
  document.getElementById('fChapter').innerHTML = '<option value="">全部章節</option>' +
    chapters.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

// ---------- browse render ----------
let activeStatus = '';

function currentFilters() {
  return {
    subject: document.getElementById('fSubject').value,
    chapter: document.getElementById('fChapter').value,
    format: document.getElementById('fType').value,
    search: document.getElementById('fSearch').value.trim().toLowerCase(),
    status: activeStatus,
  };
}

function questionImagesHtml(q) {
  if (!q.images || !q.images.length) return '';
  return `<div class="qimg-wrap">${q.images.map(src => `<img src="${escapeHtml(src)}" alt="題目附圖" loading="lazy">`).join('')}</div>`;
}

function questionExtraTagsHtml(q) {
  const extras = [];
  if (q.difficulty) extras.push(`<span class="tag diff-pill ${escapeHtml(q.difficulty)}">難易：${escapeHtml(q.difficulty)}</span>`);
  (q.tags || []).forEach(t => {
    if (t !== q.chapter) extras.push(`<span class="tag">${escapeHtml(t)}</span>`);
  });
  return extras.join('');
}

// ---------- browse card：先作答再看解答 ----------
// 使用者要先點一個選項，才會顯示正確/錯誤標示跟詳解——避免瀏覽題庫時被提前爆雷答案。
// revealedIds：已經被點過、目前顯示解答狀態的題目 id；pickedAnswer：使用者點的選項 key。
const revealedIds = new Set();
const pickedAnswer = {};

function renderQuestionCard(q) {
  const typeLabel = formatLabel(q);
  const hasAnswer = (q.answer||[]).length > 0;
  const hasExplanation = !!(q.explanation && q.explanation.trim());
  const isRevealed = revealedIds.has(q.id);
  const picked = pickedAnswer[q.id] || [];

  function optionCls(key) {
    const isCorrect = hasAnswer && (q.answer||[]).includes(key);
    const isPicked = picked.includes(key);
    if (isRevealed && hasAnswer) {
      if (isCorrect) return 'correct';
      if (isPicked) return 'wrong';
      return '';
    }
    return isPicked ? 'picked' : '';
  }

  let bodyMain;
  let choiceCount;
  if (q.type === 'combo') {
    const choices = parseComboChoices(q.rule_text);
    choiceCount = choices.length;
    const statementsHtml = (q.options||[]).map(o =>
      `<div class="statement-row">${escapeHtml(o.key)}. ${escapeHtml(o.text)}</div>`).join('');
    const ruleHtml = q.rule_text ? `<div class="rule-note">作答規則：${escapeHtml(q.rule_text)}</div>` : '';
    const choicesHtml = choices.map(c =>
      `<div class="option-row ${optionCls(c.key)}" data-key="${escapeHtml(c.key)}">${escapeHtml(c.key)}. ${escapeHtml(c.text)}</div>`
    ).join('');
    bodyMain = ruleHtml + statementsHtml + choicesHtml;
  } else {
    const opts = q.options || [];
    choiceCount = opts.length;
    bodyMain = opts.map(o =>
      `<div class="option-row ${optionCls(o.key)}" data-key="${escapeHtml(o.key)}">${escapeHtml(o.key)}. ${escapeHtml(o.text)}</div>`
    ).join('');
  }

  let bodyExtra = '';
  if (!hasAnswer) bodyExtra += '<p class="no-data-note">⚠️ 此題尚未標註標準答案</p>';
  if (hasAnswer && !hasExplanation) bodyExtra += '<p class="no-data-note">⚠️ 此題尚無詳解，之後會補上</p>';

  const explainHtml = (isRevealed && hasExplanation)
    ? `<div class="explain-box"><strong>詳解：</strong>${escapeHtml(q.explanation)}</div>` : '';
  const revealHint = (!isRevealed && choiceCount > 0)
    ? '<p class="reveal-hint">👆 點選一個選項查看答案</p>' : '';

  return `
    <div class="qcard" data-id="${escapeHtml(q.id)}">
      <div class="qcard-head">
        <div style="flex:1;">
          <div class="qcard-tags">
            <span class="tag">${escapeHtml(q.subject)}</span>
            ${q.chapter ? `<span class="tag">${escapeHtml(q.chapter)}</span>` : ''}
            <span class="tag">${escapeHtml(typeLabel)}</span>
            ${q.year ? `<span class="tag">${escapeHtml(q.year)}年</span>` : ''}
            ${questionExtraTagsHtml(q)}
            ${q.source_doc ? `<span class="tag tag-source">📄 ${escapeHtml(q.source_doc)}</span>` : ''}
          </div>
          <p class="qtext">${escapeHtml(q.question)}</p>
        </div>
        <span class="status-badge ${q._status}">${STATUS_LABEL[q._status]}</span>
      </div>
      <div class="qbody">
        ${questionImagesHtml(q)}
        ${bodyMain}
        ${revealHint}
        ${bodyExtra}
        ${explainHtml}
        ${q.source ? `<p class="no-data-note" style="margin-top:8px;">來源：${escapeHtml(q.source)}</p>` : ''}
      </div>
    </div>
  `;
}

function renderList() {
  const f = currentFilters();
  const filtered = QUESTIONS.filter(q => {
    if (f.subject && q.subject !== f.subject) return false;
    if (f.chapter && q.chapter !== f.chapter) return false;
    if (f.format && q.format !== f.format) return false;
    if (f.status && q._status !== f.status) return false;
    if (f.search) {
      const hay = [q.question, ...(q.options||[]).map(o=>o.text), q.explanation||'', q.source||'', q.source_doc||''].join(' ').toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });

  document.getElementById('resultCount').textContent = `共 ${filtered.length} 題符合條件`;
  const list = document.getElementById('qlist');

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">沒有符合條件的題目</div>';
    return;
  }

  list.innerHTML = filtered.map(renderQuestionCard).join('');
}

// 點選項：標記這一題為「已作答」，只更新該題卡片本身（避免整頁重繪造成捲動位置跳動）
function setupCardInteractions() {
  document.getElementById('qlist').addEventListener('click', (e) => {
    const optRow = e.target.closest('.option-row[data-key]');
    if (!optRow) return;
    const card = optRow.closest('.qcard');
    if (!card) return;
    const qid = card.dataset.id;
    const q = QUESTIONS.find(x => x.id === qid);
    if (!q) return;
    pickedAnswer[qid] = [optRow.dataset.key];
    revealedIds.add(qid);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderQuestionCard(q).trim();
    card.replaceWith(wrapper.firstElementChild);
  });
}

// ---------- tabs ----------
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('browse').hidden = tab !== 'browse';
      document.getElementById('quiz').hidden = tab !== 'quiz';
    });
  });
}

// ---------- filter events ----------
function setupFilterEvents() {
  document.getElementById('fSubject').addEventListener('change', (e) => {
    populateChapterFilter(e.target.value);
    renderList();
  });
  document.getElementById('fChapter').addEventListener('change', renderList);
  document.getElementById('fType').addEventListener('change', renderList);
  document.getElementById('fSearch').addEventListener('input', renderList);
  document.querySelectorAll('#statusChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#statusChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeStatus = chip.dataset.status;
      renderList();
    });
  });
}

// ---------- quiz ----------
let quizState = null;

function buildQuizPool() {
  const subject = document.getElementById('quizSubject').value;
  const onlyAnswered = document.getElementById('quizOnlyAnswered').checked;
  return QUESTIONS.filter(q => {
    if (subject && q.subject !== subject) return false;
    if (onlyAnswered && (!q.answer || q.answer.length === 0)) return false;
    return true;
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setupQuiz() {
  document.getElementById('startQuiz').addEventListener('click', () => {
    const pool = buildQuizPool();
    const count = Math.max(1, Math.min(50, parseInt(document.getElementById('quizCount').value) || 10));
    if (pool.length === 0) {
      alert('目前條件下沒有可用的題目，請調整科目範圍或勾選項目');
      return;
    }
    const picked = shuffle(pool).slice(0, count);
    quizState = { questions: picked, answers: {}, submitted: false };
    document.getElementById('quizSetup').hidden = true;
    document.getElementById('quizResult').hidden = true;
    document.getElementById('quizPlay').hidden = false;
    renderQuiz();
  });
}

// 給定一題，回傳「可以讓使用者作答的選項」：一般題型就是 options；
// combo 題型（C-type/K-type）則是把 rule_text 解析成的規則選項（A/B/C/D/E），
// 敘述本身（1,2,3,4 或 A,B 陳述句）另外用唯讀方式呈現，不能點選。
function quizChoicesFor(q) {
  if (q.type === 'combo') return parseComboChoices(q.rule_text);
  return q.options || [];
}

function renderQuiz() {
  const container = document.getElementById('quizPlay');
  const html = quizState.questions.map((q, idx) => {
    const isCombo = q.type === 'combo';
    const typeLabel = formatLabel(q);
    const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
    const picked = quizState.answers[q.id] || [];
    const hasAnswer = (q.answer||[]).length > 0;

    const statementsHtml = isCombo
      ? (q.options||[]).map(o => `<div class="statement-row">${escapeHtml(o.key)}. ${escapeHtml(o.text)}</div>`).join('') +
        (q.rule_text ? `<div class="rule-note">作答規則：${escapeHtml(q.rule_text)}</div>` : '')
      : '';

    const choices = quizChoicesFor(q);
    const optsHtml = choices.map(o => {
      const isPicked = picked.includes(o.key);
      return `
        <label class="quiz-opt ${isPicked ? 'picked' : ''}">
          <input type="${inputType}" name="q_${escapeHtml(q.id)}" value="${escapeHtml(o.key)}" ${isPicked ? 'checked' : ''}
            onchange="pickAnswer('${escapeHtml(q.id)}', '${escapeHtml(o.key)}', '${escapeHtml(q.type)}')">
          ${escapeHtml(o.key)}. ${escapeHtml(o.text)}
        </label>`;
    }).join('');
    const nograde = !hasAnswer ? `<p class="quiz-nograde">⚠️ 此題尚無標準答案，僅供練習，不計入計分</p>` : '';
    return `
      <div class="quiz-q">
        <div class="qcard-tags">
          <span class="tag">${escapeHtml(q.subject)}</span>
          <span class="tag">${escapeHtml(typeLabel)}</span>
          ${q.source_doc ? `<span class="tag tag-source">📄 ${escapeHtml(q.source_doc)}</span>` : ''}
        </div>
        <p class="qtext">${idx+1}. ${escapeHtml(q.question)}</p>
        ${questionImagesHtml(q)}
        ${statementsHtml}
        ${optsHtml}
        ${nograde}
      </div>`;
  }).join('') + `<button class="btn" id="submitQuiz">交卷</button>
                  <button class="btn secondary" id="backToSetup" style="margin-left:8px;">重新設定</button>`;
  container.innerHTML = html;
  document.getElementById('submitQuiz').addEventListener('click', submitQuiz);
  document.getElementById('backToSetup').addEventListener('click', () => {
    document.getElementById('quizSetup').hidden = false;
    document.getElementById('quizPlay').hidden = true;
  });
}

function pickAnswer(qid, key, type) {
  const cur = quizState.answers[qid] || [];
  if (type === 'multiple') {
    const idx = cur.indexOf(key);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(key);
    quizState.answers[qid] = cur;
  } else {
    quizState.answers[qid] = [key];
  }
}

function submitQuiz() {
  quizState.submitted = true;
  let correct = 0, gradable = 0;
  quizState.questions.forEach(q => {
    if (!q.answer || q.answer.length === 0) return;
    gradable++;
    const picked = (quizState.answers[q.id] || []).slice().sort().join(',');
    const ans = (q.answer||[]).slice().sort().join(',');
    if (picked === ans) correct++;
  });

  document.getElementById('quizPlay').hidden = true;
  const result = document.getElementById('quizResult');
  result.hidden = false;
  result.className = 'quiz-result';
  const scoreLine = gradable > 0
    ? `<p style="font-size:20px; font-weight:600;">得分：${correct} / ${gradable}</p>`
    : `<p>此次測驗題目皆無標準答案，無法計分（僅供練習閱讀）</p>`;

  const reviewHtml = quizState.questions.map((q, idx) => {
    const isCombo = q.type === 'combo';
    const picked = quizState.answers[q.id] || [];
    const hasAnswer = (q.answer||[]).length > 0;

    const statementsHtml = isCombo
      ? (q.options||[]).map(o => `<div class="statement-row">${escapeHtml(o.key)}. ${escapeHtml(o.text)}</div>`).join('') +
        (q.rule_text ? `<div class="rule-note">作答規則：${escapeHtml(q.rule_text)}</div>` : '')
      : '';

    const choices = quizChoicesFor(q);
    const optsHtml = choices.map(o => {
      const isCorrectOpt = (q.answer||[]).includes(o.key);
      const isPicked = picked.includes(o.key);
      let cls = '';
      if (hasAnswer) {
        if (isCorrectOpt) cls = 'reveal-correct';
        else if (isPicked && !isCorrectOpt) cls = 'reveal-wrong';
      } else if (isPicked) {
        cls = 'picked';
      }
      return `<div class="quiz-opt ${cls}">${escapeHtml(o.key)}. ${escapeHtml(o.text)}</div>`;
    }).join('');
    const explainHtml = q.explanation ? `<div class="explain-box"><strong>詳解：</strong>${escapeHtml(q.explanation)}</div>` : (hasAnswer ? '<p class="no-data-note">⚠️ 此題尚無詳解</p>' : '<p class="no-data-note">⚠️ 此題尚無標準答案</p>');
    return `
      <div class="quiz-q">
        ${q.source_doc ? `<div class="qcard-tags"><span class="tag tag-source">📄 ${escapeHtml(q.source_doc)}</span></div>` : ''}
        <p class="qtext">${idx+1}. ${escapeHtml(q.question)}</p>
        ${questionImagesHtml(q)}
        ${statementsHtml}
        ${optsHtml}
        ${explainHtml}
      </div>`;
  }).join('');

  result.innerHTML = `
    <h3>測驗結果</h3>
    ${scoreLine}
    <div style="margin-top:14px;">${reviewHtml}</div>
    <button class="btn secondary" id="restartQuiz" style="margin-top:10px;">再測一次</button>
  `;
  document.getElementById('restartQuiz').addEventListener('click', () => {
    document.getElementById('quizResult').hidden = true;
    document.getElementById('quizSetup').hidden = false;
  });
}

// ---------- theme toggle ----------
function setupThemeToggle() {
  document.getElementById('themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

// ---------- init ----------
async function init() {
  setupTabs();
  setupFilterEvents();
  setupCardInteractions();
  setupQuiz();
  setupThemeToggle();

  try {
    let data, updatedAt = '';
    if (window.__EMBEDDED_QUESTIONS__) {
      // 單一檔案版本（沒有網頁伺服器可以 fetch data.json 時使用）：資料已經內嵌在頁面裡
      data = window.__EMBEDDED_QUESTIONS__;
      updatedAt = (window.__EMBEDDED_META__ && window.__EMBEDDED_META__.updated_at) || '';
    } else {
      const [questionsRes, metaRes] = await Promise.all([
        fetch('data.json', { cache: 'no-store' }),
        fetch('meta.json', { cache: 'no-store' }).catch(() => null),
      ]);
      if (!questionsRes.ok) throw new Error('data.json 讀取失敗 (' + questionsRes.status + ')');
      data = await questionsRes.json();
      if (metaRes && metaRes.ok) {
        const meta = await metaRes.json();
        updatedAt = meta.updated_at || '';
      }
    }

    QUESTIONS = data;
    QUESTIONS.forEach(q => { q._status = questionStatus(q); });

    document.getElementById('headerSub').textContent =
      `共 ${QUESTIONS.length} 題` + (updatedAt ? `・最後更新於 ${updatedAt}` : '');

    populateSubjectFilter(document.getElementById('fSubject'), true);
    populateSubjectFilter(document.getElementById('quizSubject'), true);
    populateChapterFilter('');
    renderStats();
    renderList();
  } catch (err) {
    document.getElementById('headerSub').textContent = '題庫載入失敗';
    document.getElementById('qlist').innerHTML =
      `<div class="error-state">⚠️ 無法載入題庫資料（${escapeHtml(err.message)}）。<br>若是直接雙擊開啟這個檔案，瀏覽器可能會擋住本機檔案的讀取，請改用網頁伺服器（如 GitHub Pages）開啟。</div>`;
  }
}

init();
