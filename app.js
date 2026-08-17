let QUESTIONS = [];

// ---------- 詳解投稿（Google 表單 + 試算表，題目下面直接輸入，送出後投稿者馬上看到） ----------
// 使用方式：
//   1. 建立一份 Google 表單（欄位：題目編號 / 詳解內容 / 你的姓名暱稱(非必填)），
//      用「取得預先填寫的連結」，兩個欄位都打上測試文字，拿到 idEntryParam 跟
//      contentEntryParam（網址裡 entry.xxxxxxx=測試文字 那兩段）。
//   2. 表單會自動連動一份 Google 試算表，把那份試算表「發布到網路」匯出成 CSV，
//      把發布出來的網址填進 sheetCsvUrl。
//   3. 下面三個欄位名稱要跟表單裡實際打的欄位標題一模一樣（含全形/半形符號）。
// 只要 formBaseUrl / idEntryParam / contentEntryParam / sheetCsvUrl 任何一個是空字串，
// 這個功能就會自動隱藏，不會噴錯，所以還沒設定好之前完全不影響網站其他功能。
//
// 運作方式：送出時直接用瀏覽器背景 POST 到表單的送出網址（不會跳轉頁面），因為 Google
// 表單的送出端點不會回傳 CORS 標頭，網站讀不到「是否成功」的回應內容，所以送出後會直接
// 樂觀地把內容加進畫面（投稿者自己馬上看到）；其他訪客則是等 Google 試算表「發布到網路」
// 的快取更新（通常幾分鐘內）、而且要重新整理頁面，才會看到——這是純前端網站在沒有後端
// 資料庫的情況下，能做到最接近即時的程度。
const EXPLANATION_SUBMIT_CONFIG = {
  formBaseUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSdFLY6T4Tz3SWYizFAaoTlSa5SoeW5QqoLSH5qqbU1QfKwfiQ/viewform',
  idEntryParam: 'entry.469862127',
  contentEntryParam: 'entry.1171621119',
  sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSOuWklpGvB-ebDKSKw8gpuTGHTUP3hU5eXPq0CA6Qz0RnhY0xBIpoj0tIpjqoXY8AoRHLrYf6Ks1Gm/pub?output=csv',
  idColumn: '題目編號',
  contentColumn: '詳解內容',
  nameColumn: '',  // 目前表單沒有姓名/暱稱欄位，留空字串就會自動不顯示署名
};

// qid -> [{content, name}]，網站載入時從 Google 試算表抓一次，送出後也會樂觀地加進來
let SUBMITTED_EXPLANATIONS = {};

// ---------- 缺答案題目：讓瀏覽者投稿正確答案 ----------
// 沿用跟詳解投稿同一份 Google 表單／試算表（同一個「詳解內容」欄位），但用一個不會跟
// 一般詳解文字搞混的固定格式標記出來："[[ANSWER:C]]"。讀回來的時候只要偵測到這個格式，
// 就當作「投稿答案」處理（不會被當成一般詳解顯示），不需要使用者另外去 Google 表單加欄位。
const ANSWER_MARKER_RE = /^\[\[ANSWER:([A-Za-z0-9]+)\]\]$/;
function buildAnswerMarker(key) { return `[[ANSWER:${key}]]`; }

// qid -> [key, key, ...]，依投稿順序排列；有效答案採「最新一筆投稿」為準（若有人之後訂正，
// 以最後送出的為主），沒有審核機制
let SUBMITTED_ANSWERS = {};

// 這一題「目前實際可用的答案」：原始資料裡有標準答案就用那個；沒有的話，如果有同學投稿過
// 答案，就用最新一筆投稿的答案（未經審核，僅供參考）；兩者都沒有就回傳空陣列（缺答案）。
function effectiveAnswer(q) {
  if (Array.isArray(q.answer) && q.answer.length > 0) return q.answer;
  const subs = SUBMITTED_ANSWERS[q.id];
  if (subs && subs.length) return [subs[subs.length - 1]];
  return [];
}
function isCrowdAnswer(q) {
  return !(Array.isArray(q.answer) && q.answer.length > 0) && effectiveAnswer(q).length > 0;
}

// 這一題「目前是否有詳解可看」：正式資料裡的 explanation 欄位，或是同學投稿過的詳解，
// 只要有一種就算數——分類跟徽章（缺答案/詳解 → 有詳解）都用這個判斷，而不是只看正式欄位
function effectiveHasExplanation(q) {
  if (q.explanation && q.explanation.trim()) return true;
  const subs = SUBMITTED_EXPLANATIONS[q.id];
  return !!(subs && subs.length);
}

function inlineSubmitReady() {
  return !!(EXPLANATION_SUBMIT_CONFIG.formBaseUrl && EXPLANATION_SUBMIT_CONFIG.idEntryParam &&
    EXPLANATION_SUBMIT_CONFIG.contentEntryParam);
}

async function submitToFormInline(qid, content) {
  if (!inlineSubmitReady()) return { ok: false, reason: 'not_configured' };
  const formResponseUrl = EXPLANATION_SUBMIT_CONFIG.formBaseUrl.replace(/\/viewform.*$/, '/formResponse');
  const body = new URLSearchParams();
  body.set(EXPLANATION_SUBMIT_CONFIG.idEntryParam, qid);
  body.set(EXPLANATION_SUBMIT_CONFIG.contentEntryParam, content);
  try {
    // mode: 'no-cors' ——送出去就好，讀不到回應內容也沒關係，Google 表單的送出端點本來就
    // 不會回傳可讀取的 CORS 回應；只要 fetch() 本身沒有丟出網路層級的例外，就當作送出成功
    await fetch(formResponseUrl, { method: 'POST', mode: 'no-cors', body });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'network', error: e };
  }
}

function submitExplanationInline(qid, content) { return submitToFormInline(qid, content); }
function submitAnswerInline(qid, key) { return submitToFormInline(qid, buildAnswerMarker(key)); }

// 簡易 CSV 解析（支援雙引號包住的欄位、欄位裡的逗號跟換行）——Google 試算表匯出的 CSV 都是
// 標準 RFC4180 格式，這個小型解析器就夠用，不需要外部套件
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      // ignore, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function loadSubmittedExplanations() {
  if (!EXPLANATION_SUBMIT_CONFIG.sheetCsvUrl) return;
  try {
    const res = await fetch(EXPLANATION_SUBMIT_CONFIG.sheetCsvUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    const rows = parseCsv(text).filter(r => r.some(c => c.trim()));
    if (rows.length < 2) return;
    const header = rows[0].map(h => h.trim());
    const idIdx = header.indexOf(EXPLANATION_SUBMIT_CONFIG.idColumn);
    const contentIdx = header.indexOf(EXPLANATION_SUBMIT_CONFIG.contentColumn);
    const nameIdx = header.indexOf(EXPLANATION_SUBMIT_CONFIG.nameColumn);
    if (idIdx === -1 || contentIdx === -1) {
      console.warn('詳解投稿試算表的欄位標題跟設定不符，找不到「' + EXPLANATION_SUBMIT_CONFIG.idColumn + '」或「' + EXPLANATION_SUBMIT_CONFIG.contentColumn + '」');
      return;
    }
    const map = {};
    const answerMap = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const qid = (r[idIdx] || '').trim();
      const content = (r[contentIdx] || '').trim();
      if (!qid || !content) continue;
      const answerMatch = content.match(ANSWER_MARKER_RE);
      if (answerMatch) {
        (answerMap[qid] = answerMap[qid] || []).push(answerMatch[1].toUpperCase());
        continue;
      }
      const name = nameIdx !== -1 ? (r[nameIdx] || '').trim() : '';
      (map[qid] = map[qid] || []).push({ content, name });
    }
    SUBMITTED_EXPLANATIONS = map;
    SUBMITTED_ANSWERS = answerMap;
  } catch (e) {
    console.warn('讀取詳解投稿試算表失敗', e);
  }
}

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
  const hasAnswer = effectiveAnswer(q).length > 0;
  const hasExplanation = effectiveHasExplanation(q);
  // 只要有詳解可看（不管是正式資料還是同學投稿的）就算「有詳解」，不用一定要同時有答案——
  // 投稿詳解的人通常內容裡就會講到答案是什麼，所以詳解本身就已經是有用的資訊
  if (hasExplanation) return 'good';
  if (hasAnswer) return 'warning';
  return 'critical'; // 沒有答案，也沒有任何詳解（正式或投稿）
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

function populateChapterFilter(subject, selectEl) {
  selectEl = selectEl || document.getElementById('fChapter');
  const prevValue = selectEl.value;
  const chapters = uniqueSorted(QUESTIONS.filter(q => !subject || q.subject === subject).map(q => q.chapter).filter(Boolean));
  selectEl.innerHTML = '<option value="">全部章節</option>' +
    chapters.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  // 換科目後，如果原本選的章節在新科目底下還存在，就保留選取，不要每次都跳回「全部章節」
  if (chapters.includes(prevValue)) selectEl.value = prevValue;
}

function populateSourceDocFilter(selectEl) {
  const docs = uniqueSorted(QUESTIONS.map(q => q.source_doc || q.source_file).filter(Boolean));
  selectEl.innerHTML = '<option value="">全部檔案</option>' +
    docs.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
}

// ---------- browse render ----------
let activeStatus = '';

function currentFilters() {
  return {
    subject: document.getElementById('fSubject').value,
    chapter: document.getElementById('fChapter').value,
    format: document.getElementById('fType').value,
    sourceDoc: document.getElementById('fSourceDoc').value,
    search: document.getElementById('fSearch').value.trim().toLowerCase(),
    status: activeStatus,
  };
}

function questionImagesHtml(q) {
  if (!q.images || !q.images.length) return '';
  return `<div class="qimg-wrap">${q.images.map(src => `<img src="${escapeHtml(src)}" alt="題目附圖" loading="lazy">`).join('')}</div>`;
}

function submittedExplanationsHtml(q) {
  const subs = SUBMITTED_EXPLANATIONS[q.id];
  if (!subs || !subs.length) return '';
  return `<div class="submitted-explain-wrap">
    <div class="submitted-explain-label">🙋 同學投稿的詳解（即時顯示，未經審核，僅供參考）</div>
    ${subs.map(s => `<div class="submitted-explain-box">${escapeHtml(s.content)}${s.name ? `<div class="submitted-explain-name">— ${escapeHtml(s.name)}</div>` : ''}</div>`).join('')}
  </div>`;
}

function inlineExplainFormHtml(q) {
  if (!inlineSubmitReady()) return '';
  return `
    <div class="inline-explain-form" data-qid="${escapeHtml(q.id)}">
      <div class="inline-explain-label">✏️ 新增／補充詳解</div>
      <textarea class="inline-explain-input" rows="2" placeholder="打上你的詳解，送出後會直接顯示在這一題下面（未經審核，其他同學重新整理頁面後也會看到）…"></textarea>
      <div class="inline-explain-actions">
        <button type="button" class="btn secondary inline-explain-submit">送出</button>
        <span class="inline-explain-status"></span>
      </div>
    </div>
  `;
}

function inlineAnswerFormHtml(q, crowdAnswer) {
  if (!inlineSubmitReady()) return '';
  const choices = quizChoicesFor(q);
  if (!choices.length) return '';
  const label = crowdAnswer
    ? '🎯 覺得投稿的答案不對？可以重新投稿更正（以最新一筆為準）：'
    : '🎯 這題目前沒有標準答案，如果你知道正解，歡迎幫忙投稿（未經審核，送出後這題會直接改標成「有答案」）：';
  const btnsHtml = choices.map(c =>
    `<button type="button" class="btn secondary answer-opt-btn" data-key="${escapeHtml(c.key)}">${escapeHtml(c.key)}</button>`
  ).join('');
  return `
    <div class="inline-answer-form" data-qid="${escapeHtml(q.id)}">
      <div class="inline-answer-label">${label}</div>
      <div class="inline-answer-actions">
        ${btnsHtml}
        <span class="inline-answer-status"></span>
      </div>
    </div>
  `;
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
  const answer = effectiveAnswer(q);
  const hasAnswer = answer.length > 0;
  const hasOfficialExplanation = !!(q.explanation && q.explanation.trim());
  const hasAnyExplanation = effectiveHasExplanation(q);
  const isRevealed = revealedIds.has(q.id);
  const picked = pickedAnswer[q.id] || [];

  function optionCls(key) {
    const isCorrect = hasAnswer && answer.includes(key);
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

  const hasOriginalAnswer = Array.isArray(q.answer) && q.answer.length > 0;
  const crowdAnswer = !hasOriginalAnswer && hasAnswer;

  let bodyExtra = '';
  if (!hasOriginalAnswer && !crowdAnswer) bodyExtra += '<p class="no-data-note">⚠️ 此題尚未標註標準答案</p>';
  // 投稿答案本身就是「答案」，會爆雷，所以跟詳解、正確/錯誤標示一樣，要點了選項查看答案之後才顯示
  if (crowdAnswer && isRevealed) bodyExtra += `<p class="no-data-note">🙋 答案由同學投稿（未經審核，僅供參考）：${escapeHtml(answer.join('、'))}</p>`;
  if (hasAnswer && !hasAnyExplanation) bodyExtra += '<p class="no-data-note">⚠️ 此題尚無詳解，之後會補上</p>';

  const explainHtml = (isRevealed && hasOfficialExplanation)
    ? `<div class="explain-box"><strong>詳解：</strong>${escapeHtml(q.explanation)}</div>` : '';
  const revealHint = (!isRevealed && choiceCount > 0)
    ? '<p class="reveal-hint">👆 點選一個選項查看答案</p>' : '';
  // 同學投稿的詳解要先點選項查看答案才會出現，避免還沒作答就被投稿內容爆雷答案。
  // 輸入框本身不受此限制（空白文字框不會爆雷），沒有選項資料/還沒標答案的題目也看得到。
  const submittedHtml = isRevealed ? submittedExplanationsHtml(q) : '';
  const inlineFormHtml = inlineExplainFormHtml(q);
  // 原始資料完全沒有標準答案的題目，才顯示「投稿正確答案」欄位——已經有官方答案的題目不需要。
  const answerFormHtml = !hasOriginalAnswer ? inlineAnswerFormHtml(q, crowdAnswer) : '';

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
        ${answerFormHtml}
        ${explainHtml}
        ${submittedHtml}
        ${q.source ? `<p class="no-data-note" style="margin-top:8px;">來源：${escapeHtml(q.source)}</p>` : ''}
        ${inlineFormHtml}
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
    if (f.sourceDoc && (q.source_doc || q.source_file) !== f.sourceDoc) return false;
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
    const submitBtn = e.target.closest('.inline-explain-submit');
    if (submitBtn) {
      handleInlineExplainSubmit(submitBtn);
      return;
    }

    const answerBtn = e.target.closest('.answer-opt-btn');
    if (answerBtn) {
      handleInlineAnswerSubmit(answerBtn);
      return;
    }

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

function handleInlineExplainSubmit(submitBtn) {
  const wrap = submitBtn.closest('.inline-explain-form');
  if (!wrap) return;
  const qid = wrap.dataset.qid;
  const textarea = wrap.querySelector('.inline-explain-input');
  const statusEl = wrap.querySelector('.inline-explain-status');
  const content = (textarea.value || '').trim();
  if (!content) {
    statusEl.textContent = '請先輸入詳解內容再送出';
    return;
  }
  submitBtn.disabled = true;
  textarea.disabled = true;
  statusEl.textContent = '送出中…';

  submitExplanationInline(qid, content).then(result => {
    if (!result.ok) {
      submitBtn.disabled = false;
      textarea.disabled = false;
      statusEl.textContent = '送出失敗，請檢查網路連線後再試一次';
      return;
    }
    // 樂觀更新：讀不到 Google 表單的回應內容，但送出沒有丟出錯誤就當作成功，
    // 直接把內容加進畫面讓投稿的人立刻看到自己剛打的詳解
    (SUBMITTED_EXPLANATIONS[qid] = SUBMITTED_EXPLANATIONS[qid] || []).push({ content, name: '' });
    const q = QUESTIONS.find(x => x.id === qid);
    if (!q) return;
    const card = wrap.closest('.qcard');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderQuestionCard(q).trim();
    card.replaceWith(wrapper.firstElementChild);
  });
}

function handleInlineAnswerSubmit(answerBtn) {
  const wrap = answerBtn.closest('.inline-answer-form');
  if (!wrap) return;
  const qid = wrap.dataset.qid;
  const key = answerBtn.dataset.key;
  const statusEl = wrap.querySelector('.inline-answer-status');
  wrap.querySelectorAll('.answer-opt-btn').forEach(b => b.disabled = true);
  statusEl.textContent = '送出中…';

  submitAnswerInline(qid, key).then(result => {
    if (!result.ok) {
      wrap.querySelectorAll('.answer-opt-btn').forEach(b => b.disabled = false);
      statusEl.textContent = '送出失敗，請檢查網路連線後再試一次';
      return;
    }
    // 樂觀更新：直接把投稿的答案加進畫面，這題立刻變成「有答案」——包括選項的
    // 正確/錯誤顏色標示、上方分類徽章、統計數字，都改用這筆投稿答案為準
    (SUBMITTED_ANSWERS[qid] = SUBMITTED_ANSWERS[qid] || []).push(key.toUpperCase());
    const q = QUESTIONS.find(x => x.id === qid);
    if (!q) return;
    q._status = questionStatus(q);
    const card = wrap.closest('.qcard');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderQuestionCard(q).trim();
    card.replaceWith(wrapper.firstElementChild);
    renderStats();
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
  document.getElementById('fSourceDoc').addEventListener('change', renderList);
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

function setupQuizFilterEvents() {
  document.getElementById('quizSubject').addEventListener('change', (e) => {
    populateChapterFilter(e.target.value, document.getElementById('quizChapter'));
  });
}

function buildQuizPool() {
  const subject = document.getElementById('quizSubject').value;
  const chapter = document.getElementById('quizChapter').value;
  const format = document.getElementById('quizType').value;
  const sourceDoc = document.getElementById('quizSourceDoc').value;
  const onlyAnswered = document.getElementById('quizOnlyAnswered').checked;
  return QUESTIONS.filter(q => {
    if (subject && q.subject !== subject) return false;
    if (chapter && q.chapter !== chapter) return false;
    if (format && q.format !== format) return false;
    if (sourceDoc && (q.source_doc || q.source_file) !== sourceDoc) return false;
    if (onlyAnswered && effectiveAnswer(q).length === 0) return false;
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
      alert('目前條件下沒有可用的題目，請調整科目／章節／題型／來源檔案或勾選項目');
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
    const hasAnswer = effectiveAnswer(q).length > 0;

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
    const ansArr = effectiveAnswer(q);
    if (ansArr.length === 0) return;
    gradable++;
    const picked = (quizState.answers[q.id] || []).slice().sort().join(',');
    const ans = ansArr.slice().sort().join(',');
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
    const ansArr = effectiveAnswer(q);
    const hasAnswer = ansArr.length > 0;

    const statementsHtml = isCombo
      ? (q.options||[]).map(o => `<div class="statement-row">${escapeHtml(o.key)}. ${escapeHtml(o.text)}</div>`).join('') +
        (q.rule_text ? `<div class="rule-note">作答規則：${escapeHtml(q.rule_text)}</div>` : '')
      : '';

    const choices = quizChoicesFor(q);
    const optsHtml = choices.map(o => {
      const isCorrectOpt = ansArr.includes(o.key);
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
  setupQuizFilterEvents();
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
    populateChapterFilter('', document.getElementById('fChapter'));
    populateChapterFilter('', document.getElementById('quizChapter'));
    populateSourceDocFilter(document.getElementById('fSourceDoc'));
    populateSourceDocFilter(document.getElementById('quizSourceDoc'));
    renderStats();
    renderList();

    // 同學投稿的詳解／答案（Google 試算表）不擋主要題庫的顯示，背景讀取完再補畫一次；
    // 投稿答案會影響「有答案／缺答案」分類，所以要重新算一次 _status 跟統計數字
    loadSubmittedExplanations().then(() => {
      QUESTIONS.forEach(q => { q._status = questionStatus(q); });
      renderStats();
      renderList();
    });
  } catch (err) {
    document.getElementById('headerSub').textContent = '題庫載入失敗';
    document.getElementById('qlist').innerHTML =
      `<div class="error-state">⚠️ 無法載入題庫資料（${escapeHtml(err.message)}）。<br>若是直接雙擊開啟這個檔案，瀏覽器可能會擋住本機檔案的讀取，請改用網頁伺服器（如 GitHub Pages）開啟。</div>`;
  }
}

init();
