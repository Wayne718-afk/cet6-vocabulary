const STORAGE_KEY = "shici-cet6-library-v1";
const TODAY_KEY = "shici-cet6-today-v1";
const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60, 120];
const SUPPORTED_EXTENSIONS = ["txt", "csv", "docx", "xlsx"];

const state = {
  entries: loadEntries(),
  currentView: "import",
  quizMode: "word",
  quizStrategy: "spaced",
  libraryMode: "word",
  currentQuizEntry: null,
  quizPool: [],
  revealed: false,
  sessionDone: 0,
  sessionKnown: 0,
  todayReviewed: loadTodayReviewed()
};

const elements = {
  importText: document.querySelector("#importText"),
  importButton: document.querySelector("#importButton"),
  lineStatus: document.querySelector("#lineStatus"),
  fileInput: document.querySelector("#fileInput"),
  chooseFile: document.querySelector("#chooseFile"),
  dropZone: document.querySelector("#dropZone"),
  clearInput: document.querySelector("#clearInput"),
  fillSample: document.querySelector("#fillSample"),
  wordCount: document.querySelector("#wordCount"),
  phraseCount: document.querySelector("#phraseCount"),
  todayReviewed: document.querySelector("#todayReviewed"),
  quizWordCount: document.querySelector("#quizWordCount"),
  quizPhraseCount: document.querySelector("#quizPhraseCount"),
  dueCount: document.querySelector("#dueCount"),
  strategyDescription: document.querySelector("#strategyDescription"),
  quizHint: document.querySelector("#quizHint"),
  quizCard: document.querySelector("#quizCard"),
  quizType: document.querySelector("#quizType"),
  cardCounter: document.querySelector("#cardCounter"),
  quizTerm: document.querySelector("#quizTerm"),
  quizMeaning: document.querySelector("#quizMeaning"),
  revealAnswer: document.querySelector("#revealAnswer"),
  markAgain: document.querySelector("#markAgain"),
  markKnown: document.querySelector("#markKnown"),
  resetSession: document.querySelector("#resetSession"),
  sessionDone: document.querySelector("#sessionDone"),
  sessionKnown: document.querySelector("#sessionKnown"),
  libraryWordCount: document.querySelector("#libraryWordCount"),
  libraryPhraseCount: document.querySelector("#libraryPhraseCount"),
  librarySearch: document.querySelector("#librarySearch"),
  librarySummary: document.querySelector("#librarySummary"),
  vocabularyList: document.querySelector("#vocabularyList"),
  emptyList: document.querySelector("#emptyList"),
  clearLibrary: document.querySelector("#clearLibrary"),
  exportLibrary: document.querySelector("#exportLibrary"),
  toast: document.querySelector("#toast"),
  toastTitle: document.querySelector("#toastTitle"),
  toastMessage: document.querySelector("#toastMessage")
};

let toastTimer;

function normalizeEntry(entry) {
  const now = new Date().toISOString();
  const stage = Number.isFinite(Number(entry.reviewStage))
    ? Math.max(0, Math.min(REVIEW_INTERVALS_DAYS.length, Number(entry.reviewStage)))
    : 0;

  return {
    ...entry,
    id: entry.id || generateId(),
    createdAt: entry.createdAt || now,
    reviewCount: Number(entry.reviewCount) || 0,
    masteredCount: Number(entry.masteredCount) || 0,
    lastReviewed: entry.lastReviewed || null,
    reviewStage: stage,
    lapseCount: Number(entry.lapseCount) || 0,
    nextReviewAt: entry.nextReviewAt || now
  };
}

function loadEntries() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored.map(normalizeEntry) : [];
  } catch {
    return [];
  }
}

function loadTodayReviewed() {
  try {
    const stored = JSON.parse(localStorage.getItem(TODAY_KEY));
    return stored?.date === localDateKey() ? Number(stored.count) || 0 : 0;
  } catch {
    return 0;
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
}

function saveTodayReviewed() {
  localStorage.setItem(TODAY_KEY, JSON.stringify({
    date: localDateKey(),
    count: state.todayReviewed
  }));
}

function generateId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(title, message, type = "success") {
  clearTimeout(toastTimer);
  elements.toastTitle.textContent = title;
  elements.toastMessage.textContent = message;
  elements.toast.classList.toggle("error", type === "error");
  elements.toast.querySelector(".toast-icon").textContent = type === "error" ? "!" : "✓";
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function switchView(viewName) {
  if (!document.querySelector(`#view-${viewName}`)) return;

  clearTimeout(toastTimer);
  elements.toast.classList.remove("visible");
  state.currentView = viewName;
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  if (viewName === "quiz") {
    ensureQuizEntry();
    renderQuiz();
  }
  if (viewName === "library") {
    renderLibrary();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function parseImportText(text) {
  const parsed = [];
  const invalid = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const pair = splitVocabularyLine(line);
    if (!pair) {
      invalid.push(index + 1);
      return;
    }

    let [term, meaning] = pair.map(cleanField);
    if (!term || !meaning) {
      invalid.push(index + 1);
      return;
    }

    if (isHeaderRow(term, meaning)) return;

    if (!containsLatin(term) && containsLatin(meaning)) {
      [term, meaning] = [meaning, term];
    }

    if (!containsLatin(term)) {
      invalid.push(index + 1);
      return;
    }

    const normalizedTerm = term.replace(/\s+/g, " ").trim();
    parsed.push({
      term: normalizedTerm,
      meaning,
      type: /\s/.test(normalizedTerm) ? "phrase" : "word"
    });
  });

  return { parsed, invalid };
}

function splitVocabularyLine(line) {
  const tabIndex = line.indexOf("\t");
  if (tabIndex >= 0) {
    return [line.slice(0, tabIndex), line.slice(tabIndex + 1)];
  }

  for (const delimiter of ["=", "|", "：", ":"]) {
    const index = line.indexOf(delimiter);
    if (index > 0 && index < line.length - 1) {
      return [line.slice(0, index), line.slice(index + delimiter.length)];
    }
  }

  return splitCsvLine(line);
}

function splitCsvLine(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (quoted && line[index + 1] === "\"") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    }
    if ((character === "," || character === "，") && !quoted) {
      return [line.slice(0, index), line.slice(index + 1)];
    }
  }
  return null;
}

function cleanField(value) {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/""/g, "\"")
    .trim();
}

function containsLatin(value) {
  return /[a-zA-Z]/.test(value);
}

function isHeaderRow(term, meaning) {
  const first = term.toLocaleLowerCase().replace(/\s+/g, "");
  const second = meaning.toLocaleLowerCase().replace(/\s+/g, "");
  const termHeaders = ["英文", "单词", "词组", "词汇", "word", "phrase", "vocabulary", "english"];
  const meaningHeaders = ["中文", "释义", "意思", "翻译", "meaning", "translation", "chinese"];
  return termHeaders.includes(first) && meaningHeaders.includes(second);
}

function updateImportPreview() {
  const text = elements.importText.value;
  const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim()).length;
  const { parsed, invalid } = parseImportText(text);
  const wordCount = parsed.filter((entry) => entry.type === "word").length;
  const phraseCount = parsed.length - wordCount;

  if (!nonEmptyLines) {
    elements.lineStatus.textContent = "等待输入";
    elements.importButton.disabled = true;
    return;
  }

  const invalidText = invalid.length ? `，${invalid.length} 行未识别` : "";
  elements.lineStatus.textContent = `识别到 ${wordCount} 个单词、${phraseCount} 个词组${invalidText}`;
  elements.importButton.disabled = parsed.length === 0;
}

function importVocabulary() {
  const { parsed, invalid } = parseImportText(elements.importText.value);
  if (!parsed.length) {
    showToast("没有可导入的内容", "请检查每行是否包含英文和释义", "error");
    return;
  }

  const existingKeys = new Set(
    state.entries.map((entry) => `${entry.type}:${entry.term.toLocaleLowerCase()}`)
  );
  const seenThisImport = new Set();
  const additions = [];
  let duplicateCount = 0;
  const now = new Date().toISOString();

  parsed.forEach((entry) => {
    const key = `${entry.type}:${entry.term.toLocaleLowerCase()}`;
    if (existingKeys.has(key) || seenThisImport.has(key)) {
      duplicateCount += 1;
      return;
    }
    seenThisImport.add(key);
    additions.push({
      ...entry,
      id: generateId(),
      createdAt: now,
      reviewCount: 0,
      masteredCount: 0,
      lastReviewed: null,
      reviewStage: 0,
      lapseCount: 0,
      nextReviewAt: now
    });
  });

  state.entries.push(...additions);
  saveEntries();
  elements.importText.value = "";
  updateImportPreview();
  resetQuizQueue();
  renderCounts();

  const wordAdded = additions.filter((entry) => entry.type === "word").length;
  const phraseAdded = additions.length - wordAdded;
  const details = [`${wordAdded} 个单词`, `${phraseAdded} 个词组`];
  if (duplicateCount) details.push(`跳过 ${duplicateCount} 条重复内容`);
  if (invalid.length) details.push(`${invalid.length} 行未识别`);

  showToast(additions.length ? "导入完成" : "没有新增内容", details.join("，"));
}

async function readFile(file) {
  if (!file) return;
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "doc" || extension === "xls") {
    showToast("请另存为新版格式", "Word 请使用 DOCX，Excel 请使用 XLSX", "error");
    return;
  }
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    showToast("文件格式不支持", "请选择 TXT、CSV、DOCX 或 XLSX 文件", "error");
    return;
  }

  elements.lineStatus.textContent = `正在读取 ${file.name}…`;
  elements.importButton.disabled = true;

  try {
    let content;
    if (extension === "docx") {
      content = await extractDocxText(await file.arrayBuffer());
    } else if (extension === "xlsx") {
      content = await extractXlsxText(await file.arrayBuffer());
    } else {
      content = await file.text();
    }

    if (!content.trim()) {
      throw new Error("文件中没有识别到可用的词汇行");
    }

    elements.importText.value = content;
    updateImportPreview();
    showToast("文件已读取", `${file.name} 的内容已整理到输入框`);
  } catch (error) {
    console.error(error);
    elements.importText.value = "";
    updateImportPreview();
    showToast("读取失败", error.message || "无法读取这个文件，请检查格式", "error");
  }
}

async function extractDocxText(arrayBuffer) {
  ensureZipLibrary();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("这不是有效的 DOCX 文件");

  const documentXml = parseXml(await documentFile.async("string"));
  const body = getElementsByLocalName(documentXml, "body")[0];
  if (!body) return "";

  const lines = [];
  Array.from(body.children).forEach((child) => {
    if (child.localName === "p") {
      const text = extractWordParagraph(child);
      if (text) lines.push(text);
    }

    if (child.localName === "tbl") {
      getElementsByLocalName(child, "tr").forEach((row) => {
        const cells = Array.from(row.children)
          .filter((node) => node.localName === "tc")
          .map((cell) => getElementsByLocalName(cell, "p")
            .map(extractWordParagraph)
            .filter(Boolean)
            .join(" "))
          .filter(Boolean);
        if (cells.length >= 2) {
          lines.push(`${cells[0]}\t${cells.slice(1).join("；")}`);
        } else if (cells.length === 1) {
          lines.push(cells[0]);
        }
      });
    }
  });
  return lines.join("\n");
}

function extractWordParagraph(paragraph) {
  const parts = [];
  const visit = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.localName === "t") {
      parts.push(node.textContent || "");
      return;
    }
    if (node.localName === "tab") {
      parts.push("\t");
      return;
    }
    if (node.localName === "br") {
      parts.push(" ");
      return;
    }
    Array.from(node.childNodes).forEach(visit);
  };
  visit(paragraph);
  return parts.join("").replace(/[ \u00a0]+/g, " ").trim();
}

async function extractXlsxText(arrayBuffer) {
  ensureZipLibrary();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const sheetPath = await getFirstWorksheetPath(zip);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error("Excel 文件中没有找到工作表");

  const sharedStrings = await readSharedStrings(zip);
  const sheetXml = parseXml(await sheetFile.async("string"));
  const lines = [];

  getElementsByLocalName(sheetXml, "row").forEach((row) => {
    const values = [];
    getElementsByLocalName(row, "c").forEach((cell) => {
      const reference = cell.getAttribute("r") || "";
      const columnIndex = columnReferenceToIndex(reference);
      const value = readSpreadsheetCell(cell, sharedStrings);
      if (value !== "") values[columnIndex] = value;
    });

    const nonEmpty = values
      .map((value, index) => ({ value: cleanField(value || ""), index }))
      .filter((item) => item.value);
    if (nonEmpty.length >= 2) {
      lines.push(`${nonEmpty[0].value}\t${nonEmpty.slice(1).map((item) => item.value).join("；")}`);
    } else if (nonEmpty.length === 1) {
      lines.push(nonEmpty[0].value);
    }
  });

  return lines.join("\n");
}

async function getFirstWorksheetPath(zip) {
  const workbookFile = zip.file("xl/workbook.xml");
  const relationsFile = zip.file("xl/_rels/workbook.xml.rels");

  if (workbookFile && relationsFile) {
    const workbook = parseXml(await workbookFile.async("string"));
    const relations = parseXml(await relationsFile.async("string"));
    const firstSheet = getElementsByLocalName(workbook, "sheet")[0];
    const relationId = firstSheet ? getAttributeByLocalName(firstSheet, "id") : "";
    const relation = getElementsByLocalName(relations, "Relationship")
      .find((item) => item.getAttribute("Id") === relationId);
    const target = relation?.getAttribute("Target");
    if (target) {
      return target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^(\.\.\/)+/, "")}`;
    }
  }

  const fallback = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort()[0];
  if (!fallback) throw new Error("Excel 文件中没有找到工作表");
  return fallback;
}

async function readSharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = parseXml(await file.async("string"));
  return getElementsByLocalName(xml, "si").map((item) => (
    getElementsByLocalName(item, "t").map((node) => node.textContent || "").join("")
  ));
}

function readSpreadsheetCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return getElementsByLocalName(cell, "t").map((node) => node.textContent || "").join("");
  }

  const valueNode = getElementsByLocalName(cell, "v")[0];
  const value = valueNode?.textContent || "";
  if (type === "s") return sharedStrings[Number(value)] || "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value;
}

function columnReferenceToIndex(reference) {
  const letters = (reference.match(/[A-Z]+/i) || ["A"])[0].toUpperCase();
  return letters.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function ensureZipLibrary() {
  if (typeof JSZip === "undefined") {
    throw new Error("文件解析组件未加载，请刷新页面后重试");
  }
}

function parseXml(xml) {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  if (documentNode.querySelector("parsererror")) {
    throw new Error("文件内部格式无法识别");
  }
  return documentNode;
}

function getElementsByLocalName(root, localName) {
  return Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === localName);
}

function getAttributeByLocalName(element, localName) {
  return Array.from(element.attributes).find((attribute) => attribute.localName === localName)?.value || "";
}

function isDue(entry, at = Date.now()) {
  const dueTime = Date.parse(entry.nextReviewAt);
  return !Number.isFinite(dueTime) || dueTime <= at;
}

function getModeEntries(mode = state.quizMode) {
  return state.entries.filter((entry) => entry.type === mode);
}

function getDueEntries(mode) {
  return state.entries.filter((entry) => (!mode || entry.type === mode) && isDue(entry));
}

function getAvailableQuizEntries() {
  const entries = getModeEntries();
  return state.quizStrategy === "spaced" ? entries.filter((entry) => isDue(entry)) : entries;
}

function renderCounts() {
  const words = state.entries.filter((entry) => entry.type === "word");
  const phrases = state.entries.filter((entry) => entry.type === "phrase");
  const dueWords = words.filter((entry) => isDue(entry)).length;
  const duePhrases = phrases.filter((entry) => isDue(entry)).length;

  elements.wordCount.textContent = words.length;
  elements.phraseCount.textContent = phrases.length;
  elements.quizWordCount.textContent = state.quizStrategy === "spaced" ? dueWords : words.length;
  elements.quizPhraseCount.textContent = state.quizStrategy === "spaced" ? duePhrases : phrases.length;
  elements.libraryWordCount.textContent = words.length;
  elements.libraryPhraseCount.textContent = phrases.length;
  elements.todayReviewed.textContent = state.todayReviewed;
  elements.dueCount.textContent = dueWords + duePhrases;
}

function refillQuizPool() {
  const entries = getAvailableQuizEntries();

  if (state.quizStrategy === "spaced") {
    entries.sort((first, second) => {
      const dueDifference = Date.parse(first.nextReviewAt) - Date.parse(second.nextReviewAt);
      return dueDifference || first.reviewStage - second.reviewStage;
    });
  } else {
    for (let index = entries.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [entries[index], entries[randomIndex]] = [entries[randomIndex], entries[index]];
    }
  }

  const ids = entries.map((entry) => entry.id);
  if (ids.length > 1 && ids[0] === state.currentQuizEntry?.id) {
    [ids[0], ids[1]] = [ids[1], ids[0]];
  }
  state.quizPool = ids;
}

function ensureQuizEntry(forceNext = false) {
  const available = getAvailableQuizEntries();
  const availableIds = new Set(available.map((entry) => entry.id));
  if (!available.length) {
    state.currentQuizEntry = null;
    state.quizPool = [];
    state.revealed = false;
    return;
  }

  const currentStillValid = availableIds.has(state.currentQuizEntry?.id);
  if (currentStillValid && !forceNext) return;

  state.quizPool = state.quizPool.filter((id) => availableIds.has(id));
  if (!state.quizPool.length) refillQuizPool();
  const nextId = state.quizPool.shift();
  state.currentQuizEntry = state.entries.find((entry) => entry.id === nextId) || available[0];
  state.revealed = false;
}

function renderQuiz() {
  const entry = state.currentQuizEntry;
  const allInMode = getModeEntries();
  const available = getAvailableQuizEntries();
  const isPhrase = state.quizMode === "phrase";
  const isSpaced = state.quizStrategy === "spaced";

  document.querySelectorAll("[data-quiz-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quizMode === state.quizMode);
  });
  document.querySelectorAll("[data-quiz-strategy]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quizStrategy === state.quizStrategy);
  });

  elements.quizType.textContent = isPhrase ? "词组" : "单词";
  elements.quizType.classList.toggle("phrase", isPhrase);
  elements.sessionDone.textContent = state.sessionDone;
  elements.sessionKnown.textContent = state.sessionKnown;
  elements.quizCard.classList.toggle("revealed", state.revealed && Boolean(entry));
  elements.strategyDescription.textContent = isSpaced
    ? "按 1、2、4、7、15、30、60 天逐步复习"
    : "从当前词库随机抽取，不改变复习日期";
  elements.quizHint.textContent = isSpaced
    ? "答对会延长下次复习间隔，答错会回到待复习队列"
    : "随机模式适合额外巩固，系统会尽量避免连续重复";

  if (!entry) {
    if (!allInMode.length) {
      elements.cardCounter.textContent = "暂无内容";
      elements.quizTerm.textContent = isPhrase ? "词组库还是空的" : "单词库还是空的";
      elements.quizMeaning.textContent = "请先导入一些内容，再回来检测。";
    } else if (isSpaced) {
      elements.cardCounter.textContent = "今日已完成";
      elements.quizTerm.textContent = "今天的复习完成了";
      elements.quizMeaning.textContent = getNextReviewMessage(allInMode);
    }
    elements.revealAnswer.disabled = true;
    return;
  }

  elements.cardCounter.textContent = isSpaced
    ? `${reviewStageLabel(entry)} · 本库待复习 ${available.length} 条`
    : `本库共 ${allInMode.length} 条`;
  elements.quizTerm.textContent = entry.term;
  elements.quizMeaning.textContent = entry.meaning;
  elements.revealAnswer.disabled = false;
}

function revealQuizAnswer() {
  if (!state.currentQuizEntry || state.revealed) return;
  state.revealed = true;
  renderQuiz();
}

function markQuizResult(known) {
  if (!state.currentQuizEntry || !state.revealed) return;

  const entry = state.entries.find((item) => item.id === state.currentQuizEntry.id);
  if (entry) {
    entry.reviewCount += 1;
    entry.masteredCount += known ? 1 : 0;
    entry.lastReviewed = new Date().toISOString();

    if (state.quizStrategy === "spaced") {
      if (known) {
        entry.reviewStage = Math.min(entry.reviewStage + 1, REVIEW_INTERVALS_DAYS.length);
        const intervalIndex = Math.max(0, entry.reviewStage - 1);
        entry.nextReviewAt = addDays(new Date(), REVIEW_INTERVALS_DAYS[intervalIndex]).toISOString();
      } else {
        entry.reviewStage = 0;
        entry.lapseCount += 1;
        entry.nextReviewAt = new Date().toISOString();
        if (!state.quizPool.includes(entry.id)) state.quizPool.push(entry.id);
      }
    }
    saveEntries();
  }

  state.sessionDone += 1;
  state.sessionKnown += known ? 1 : 0;
  state.todayReviewed += 1;
  saveTodayReviewed();
  renderCounts();
  ensureQuizEntry(true);
  renderQuiz();
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function reviewStageLabel(entry) {
  return entry.reviewStage === 0 ? "初次记忆" : `第 ${entry.reviewStage} 阶段`;
}

function getNextReviewMessage(entries) {
  const nextEntry = [...entries].sort((first, second) => (
    Date.parse(first.nextReviewAt) - Date.parse(second.nextReviewAt)
  ))[0];
  if (!nextEntry) return "暂无复习安排。";
  return `下次复习：${formatReviewDate(nextEntry.nextReviewAt)}`;
}

function formatReviewDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || isDue({ nextReviewAt: value })) return "现在";
  const tomorrow = addDays(new Date(), 1);
  if (localDateKey(date) === localDateKey()) return "今天稍后";
  if (localDateKey(date) === localDateKey(tomorrow)) return "明天";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function resetQuizQueue() {
  state.quizPool = [];
  state.currentQuizEntry = null;
  state.revealed = false;
}

function resetSession() {
  state.sessionDone = 0;
  state.sessionKnown = 0;
  resetQuizQueue();
  ensureQuizEntry();
  renderQuiz();
  showToast("本轮已重置", "检测记录从 0 重新开始");
}

function setQuizMode(mode) {
  if (state.quizMode === mode) return;
  state.quizMode = mode;
  resetQuizQueue();
  ensureQuizEntry();
  renderQuiz();
}

function setQuizStrategy(strategy) {
  if (state.quizStrategy === strategy) return;
  state.quizStrategy = strategy;
  resetQuizQueue();
  renderCounts();
  ensureQuizEntry();
  renderQuiz();
}

function renderLibrary() {
  const query = elements.librarySearch.value.trim().toLocaleLowerCase();
  const allInMode = state.entries.filter((entry) => entry.type === state.libraryMode);
  const visibleEntries = allInMode
    .filter((entry) => {
      if (!query) return true;
      return entry.term.toLocaleLowerCase().includes(query)
        || entry.meaning.toLocaleLowerCase().includes(query);
    })
    .sort((first, second) => first.term.localeCompare(second.term, "en", { sensitivity: "base" }));

  document.querySelectorAll("[data-library-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.libraryMode === state.libraryMode);
  });

  const typeLabel = state.libraryMode === "word" ? "单词" : "词组";
  elements.librarySummary.textContent = query
    ? `找到 ${visibleEntries.length} 个${typeLabel}`
    : `共 ${allInMode.length} 个${typeLabel}，${allInMode.filter((entry) => isDue(entry)).length} 个待复习`;
  elements.clearLibrary.disabled = allInMode.length === 0;
  elements.exportLibrary.disabled = allInMode.length === 0;
  elements.vocabularyList.innerHTML = "";

  visibleEntries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "vocab-row";
    const masteryRate = entry.reviewCount
      ? Math.round((entry.masteredCount / entry.reviewCount) * 100)
      : 0;

    const term = document.createElement("div");
    term.className = "vocab-term";
    term.textContent = entry.term;

    const meaning = document.createElement("div");
    meaning.className = "vocab-meaning";
    meaning.textContent = entry.meaning;

    const mastery = document.createElement("div");
    mastery.className = "mastery";
    mastery.innerHTML = `
      <span class="mastery-track"><i style="width:${masteryRate}%"></i></span>
      <span>${reviewStageLabel(entry)} · ${isDue(entry) ? "待复习" : formatReviewDate(entry.nextReviewAt)}</span>
    `;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-item";
    deleteButton.type = "button";
    deleteButton.dataset.deleteId = entry.id;
    deleteButton.setAttribute("aria-label", `删除 ${entry.term}`);
    deleteButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>`;

    row.append(term, meaning, mastery, deleteButton);
    elements.vocabularyList.appendChild(row);
  });

  const shouldShowEmpty = visibleEntries.length === 0;
  elements.emptyList.classList.toggle("visible", shouldShowEmpty);
  elements.vocabularyList.hidden = shouldShowEmpty;

  const emptyTitle = elements.emptyList.querySelector("strong");
  const emptyDescription = elements.emptyList.querySelector("p");
  if (query && !visibleEntries.length) {
    emptyTitle.textContent = "没有找到匹配内容";
    emptyDescription.textContent = "换个关键词试试看。";
  } else {
    emptyTitle.textContent = "这里还没有内容";
    emptyDescription.textContent = "导入一些词汇后，它们会整齐地出现在这里。";
  }
}

function deleteEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  state.entries = state.entries.filter((item) => item.id !== id);
  saveEntries();
  state.quizPool = state.quizPool.filter((poolId) => poolId !== id);
  if (state.currentQuizEntry?.id === id) state.currentQuizEntry = null;
  renderCounts();
  renderLibrary();
  showToast("已删除", `${entry.term} 已从词库移除`);
}

function clearCurrentLibrary() {
  const typeLabel = state.libraryMode === "word" ? "单词" : "词组";
  const count = state.entries.filter((entry) => entry.type === state.libraryMode).length;
  if (!count) return;

  const confirmed = window.confirm(`确定要清空${typeLabel}库吗？共 ${count} 条内容，清空后无法恢复。`);
  if (!confirmed) return;

  state.entries = state.entries.filter((entry) => entry.type !== state.libraryMode);
  saveEntries();
  resetQuizQueue();
  renderCounts();
  renderLibrary();
  showToast(`${typeLabel}库已清空`, `已移除 ${count} 条内容`);
}

function exportCurrentLibrary() {
  const entries = state.entries.filter((entry) => entry.type === state.libraryMode);
  if (!entries.length) {
    showToast("当前词库为空", "没有可以导出的内容", "error");
    return;
  }

  const rows = [["英文", "释义", "类型", "记忆阶段", "下次复习"], ...entries.map((entry) => [
    entry.term,
    entry.meaning,
    entry.type === "word" ? "单词" : "词组",
    reviewStageLabel(entry),
    entry.nextReviewAt
  ])];
  const csv = rows.map((row) => row.map(toCsvField).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const typeLabel = state.libraryMode === "word" ? "单词" : "词组";
  link.href = URL.createObjectURL(blob);
  link.download = `拾词-${typeLabel}库-${localDateKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast("导出完成", `${entries.length} 条内容已导出为 CSV`);
}

function toCsvField(value) {
  const stringValue = String(value);
  return /[",\r\n]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, "\"\"")}"`
    : stringValue;
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-quiz-mode]").forEach((button) => {
  button.addEventListener("click", () => setQuizMode(button.dataset.quizMode));
});

document.querySelectorAll("[data-quiz-strategy]").forEach((button) => {
  button.addEventListener("click", () => setQuizStrategy(button.dataset.quizStrategy));
});

document.querySelectorAll("[data-library-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.libraryMode = button.dataset.libraryMode;
    elements.librarySearch.value = "";
    renderLibrary();
  });
});

elements.importText.addEventListener("input", updateImportPreview);
elements.importButton.addEventListener("click", importVocabulary);
elements.clearInput.addEventListener("click", () => {
  elements.importText.value = "";
  updateImportPreview();
  elements.importText.focus();
});
elements.fillSample.addEventListener("click", () => {
  elements.importText.value = [
    "compelling, 引人注目的；令人信服的",
    "subtle = 微妙的；细微的",
    "take into account | 把……考虑在内",
    "be bound to\t一定会；必然"
  ].join("\n");
  updateImportPreview();
  elements.importText.focus();
});

elements.chooseFile.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files[0];
  elements.fileInput.value = "";
  await readFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
});
elements.dropZone.addEventListener("drop", (event) => readFile(event.dataTransfer.files[0]));

elements.revealAnswer.addEventListener("click", revealQuizAnswer);
elements.markAgain.addEventListener("click", () => markQuizResult(false));
elements.markKnown.addEventListener("click", () => markQuizResult(true));
elements.resetSession.addEventListener("click", resetSession);
elements.librarySearch.addEventListener("input", renderLibrary);
elements.clearLibrary.addEventListener("click", clearCurrentLibrary);
elements.exportLibrary.addEventListener("click", exportCurrentLibrary);
elements.vocabularyList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton) deleteEntry(deleteButton.dataset.deleteId);
});

document.addEventListener("keydown", (event) => {
  if (state.currentView !== "quiz") return;
  const tagName = document.activeElement?.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA") return;

  if (event.code === "Space") {
    event.preventDefault();
    revealQuizAnswer();
  } else if (event.key === "1") {
    markQuizResult(false);
  } else if (event.key === "2") {
    markQuizResult(true);
  }
});

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("离线缓存注册失败", error);
    });
  });
}

saveEntries();
renderCounts();
updateImportPreview();
renderLibrary();
