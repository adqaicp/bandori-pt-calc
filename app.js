const fields = {
  targetPt: document.querySelector("#targetPt"),
  currentPt: document.querySelector("#currentPt"),
  basePt: document.querySelector("#basePt"),
  bonusPercent: document.querySelector("#bonusPercent"),
  supportPt: document.querySelector("#supportPt"),
  scoreRatio: document.querySelector("#scoreRatio"),
  smartMode: document.querySelector("#smartMode"),
  multiplier: document.querySelector("#multiplier"),
  scoreMin: document.querySelector("#scoreMin"),
  scoreLimit: document.querySelector("#scoreLimit"),
};

const form = document.querySelector("#calcForm");
const resetBtn = document.querySelector("#resetBtn");
const multiplierButtons = [...document.querySelectorAll("[data-multiplier]")];
const modeTabs = [...document.querySelectorAll("[data-mode]")];
const singleModeControls = document.querySelector("#singleModeControls");
const multiModeControls = document.querySelector("#multiModeControls");
const moreButton = document.querySelector("#moreButton");
const aboutDialog = document.querySelector("#aboutDialog");
const aboutClose = document.querySelector("#aboutClose");
const modeNote = document.querySelector("#modeNote");
const resultTitle = document.querySelector("#resultTitle");
const resultBody = document.querySelector("#resultBody");
const statGrid = document.querySelector("#statGrid");

const integerFormatter = new Intl.NumberFormat("zh-CN");
const MAX_SINGLE_SCORE = 2500000;

function pyInt(value) {
  return Math.trunc(value);
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return integerFormatter.format(value);
}

function formatScoreRange(min, max) {
  return `${formatNumber(min)} - ${formatNumber(max)}`;
}

function displayValue(value) {
  return typeof value === "number" ? formatNumber(value) : value;
}

function resultNotice(state, title, body = "") {
  return { state, title, body };
}

function readNumber(input, label, options = {}) {
  const { integer = true, required = true } = options;
  const raw = input.value.trim();

  if (!raw) {
    if (required) throw new Error(`请填写${label}`);
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${label}必须是有效数字`);
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`${label}必须是整数`);
  }

  return value;
}

function bisectLeft(values, target) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }

  return low;
}

function getGamePt(basePt, bonusPercent, supportPt, scorePt) {
  const x = basePt + scorePt;
  return x + pyInt((x * bonusPercent) / 100) + supportPt;
}

function mergePointInfo(pointsMap, info) {
  const existing = pointsMap.get(info.pt);
  if (existing) {
    existing.minScore = Math.min(existing.minScore, info.minScore);
    existing.maxScore = Math.max(existing.maxScore, info.maxScore);
    return;
  }
  pointsMap.set(info.pt, info);
}

function buildPointMap(basePt, bonusPercent, supportPt, scoreRatio, scoreMin, scoreLimit) {
  const pointsMap = new Map();
  const maxScorePt = pyInt(scoreLimit / scoreRatio);
  const effectiveMinScore = Math.max(0, scoreMin);

  for (let scorePt = 0; scorePt <= maxScorePt; scorePt += 1) {
    const pt = getGamePt(basePt, bonusPercent, supportPt, scorePt);
    let minScore = pyInt(scorePt * scoreRatio);
    let maxScore = pyInt((scorePt + 1) * scoreRatio) - 1;

    if (minScore > scoreLimit) break;
    if (maxScore < effectiveMinScore) continue;
    if (minScore < effectiveMinScore) minScore = effectiveMinScore;
    if (maxScore > scoreLimit) maxScore = scoreLimit;

    mergePointInfo(pointsMap, {
      pt,
      minScore,
      maxScore,
    });
  }

  return pointsMap;
}

function findExactMultiSolution(gap, ptsValues) {
  const positivePts = ptsValues.filter((pt) => pt > 0 && pt <= gap);
  if (positivePts.length === 0) return null;

  const impossible = gap + 1;
  const games = new Int32Array(gap + 1);
  const previousPt = new Int32Array(gap + 1);
  games.fill(impossible);
  previousPt.fill(-1);
  games[0] = 0;

  for (let total = 1; total <= gap; total += 1) {
    for (const pt of positivePts) {
      if (pt > total) break;
      const candidate = games[total - pt] + 1;
      if (candidate < games[total]) {
        games[total] = candidate;
        previousPt[total] = pt;
      }
    }
  }

  if (games[gap] === impossible) return null;

  const counts = new Map();
  let cursor = gap;
  while (cursor > 0) {
    const pt = previousPt[cursor];
    if (pt <= 0) return null;
    counts.set(pt, (counts.get(pt) || 0) + 1);
    cursor -= pt;
  }

  return { games: games[gap], counts };
}

function findExactAdjustmentPlan(gap, ptsValues, ptsMap) {
  const positivePts = ptsValues.filter((pt) => pt > 0 && pt <= gap);
  if (positivePts.length === 0) return null;

  const impossibleCost = MAX_SINGLE_SCORE + 1;
  const impossibleGames = gap + 1;
  const cost = new Int32Array(gap + 1);
  const games = new Int32Array(gap + 1);
  const previousPt = new Int32Array(gap + 1);
  cost.fill(impossibleCost);
  games.fill(impossibleGames);
  previousPt.fill(-1);
  cost[0] = 0;
  games[0] = 0;

  for (let total = 1; total <= gap; total += 1) {
    for (const pt of positivePts) {
      if (pt > total) break;
      if (cost[total - pt] === impossibleCost) continue;

      const info = ptsMap.get(pt);
      const candidateCost = Math.max(cost[total - pt], info.minScore);
      const candidateGames = games[total - pt] + 1;

      if (
        candidateCost < cost[total] ||
        (candidateCost === cost[total] && candidateGames < games[total])
      ) {
        cost[total] = candidateCost;
        games[total] = candidateGames;
        previousPt[total] = pt;
      }
    }
  }

  if (cost[gap] === impossibleCost) return null;

  const counts = reconstructPointCounts(gap, previousPt);
  if (!counts) return null;
  return {
    ...buildPlanFromCounts(gap, gap, games[gap], counts, ptsMap),
    requiredScoreLimit: cost[gap],
  };
}

function findMinScoreForAtLeastPt(requiredPt, basePt, bonusPercent, supportPt, scoreRatio) {
  if (scoreRatio <= 0) return null;
  let low = 0;
  let high = pyInt(MAX_SINGLE_SCORE / scoreRatio);
  let answer = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const pt = getGamePt(basePt, bonusPercent, supportPt, mid);
    if (pt >= requiredPt) {
      answer = { scorePt: mid, pt, minScore: pyInt(mid * scoreRatio) };
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return answer;
}

function findNearbyMultiPlans(gap, ptsValues, ptsMap, limit = 6) {
  const positivePts = ptsValues.filter((pt) => pt > 0);
  if (positivePts.length === 0) return [];

  const minPt = positivePts[0];
  const maxPt = positivePts[positivePts.length - 1];
  const upperPadding = Math.max(minPt * 3, Math.min(maxPt, 5000), 1000);
  const searchMax = Math.max(minPt, gap + upperPadding);
  const usablePts = positivePts.filter((pt) => pt <= searchMax);
  const impossible = searchMax + 1;
  const games = new Int32Array(searchMax + 1);
  const previousPt = new Int32Array(searchMax + 1);
  games.fill(impossible);
  previousPt.fill(-1);
  games[0] = 0;

  for (let total = 1; total <= searchMax; total += 1) {
    for (const pt of usablePts) {
      if (pt > total) break;
      const candidate = games[total - pt] + 1;
      if (candidate < games[total]) {
        games[total] = candidate;
        previousPt[total] = pt;
      }
    }
  }

  const candidates = [];
  for (let total = 1; total <= searchMax; total += 1) {
    if (total === gap || games[total] === impossible) continue;
    const counts = reconstructPointCounts(total, previousPt);
    if (!counts) continue;
    candidates.push(buildPlanFromCounts(total, gap, games[total], counts, ptsMap));
  }

  return pickBalancedNearbyPlans(candidates, limit);
}

function pickBalancedNearbyPlans(candidates, limit) {
  const sortPlans = (plans) =>
    plans.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.games - b.games || b.total - a.total);
  const below = sortPlans(candidates.filter((plan) => plan.delta < 0));
  const above = sortPlans(candidates.filter((plan) => plan.delta > 0));
  const picked = [];
  const seen = new Set();

  function add(plan) {
    if (!plan || picked.length >= limit) return;
    const key = `${plan.total}:${plan.games}:${plan.lines.map((line) => `${line.pt}x${line.count}`).join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(plan);
  }

  for (let index = 0; picked.length < limit && (index < above.length || index < below.length); index += 1) {
    add(above[index]);
    add(below[index]);
  }

  if (picked.length < limit) {
    sortPlans(candidates).forEach(add);
  }

  return picked;
}

function reconstructPointCounts(total, previousPt) {
  const counts = new Map();
  let cursor = total;
  while (cursor > 0) {
    const pt = previousPt[cursor];
    if (pt <= 0) return null;
    counts.set(pt, (counts.get(pt) || 0) + 1);
    cursor -= pt;
  }
  return counts;
}

function buildPlanFromCounts(total, gap, games, counts, ptsMap) {
  const lines = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([pt, count]) => {
      const info = ptsMap.get(pt);
      return {
        count,
        pt,
        minScore: info.minScore,
        maxScore: info.maxScore,
      };
    });

  return {
    games,
    total,
    delta: total - gap,
    lines,
  };
}

function formatGameBreakdown(count) {
  if (count < 5) return `${formatNumber(count)} 局`;
  const grouped = Math.floor(count / 5) * 5;
  const rest = count - grouped;
  if (rest === 0) return `${formatNumber(count)} 局`;
  return `${formatNumber(count)} 局（${formatNumber(grouped)} 局 + ${formatNumber(rest)} 局）`;
}

function getBaseParams() {
  const targetPt = readNumber(fields.targetPt, "目标 Pt");
  const currentPt = readNumber(fields.currentPt, "当前 Pt");
  const basePt = readNumber(fields.basePt, "基本 Pt");
  const bonusPercent = readNumber(fields.bonusPercent, "活动加成", { integer: false });
  const supportPt = readNumber(fields.supportPt, "支援乐队 Pt");
  const scoreRatio = readNumber(fields.scoreRatio, "得分比", { integer: false });

  return { targetPt, currentPt, basePt, bonusPercent, supportPt, scoreRatio };
}

function getScoreBounds() {
  const scoreMin = readNumber(fields.scoreMin, "单局分数下限");
  const scoreLimit = readNumber(fields.scoreLimit, "单局分数上限");

  if (scoreMin < 0) {
    throw new Error("单局分数下限不能小于 0");
  }

  if (scoreLimit < 0) {
    throw new Error("单局分数上限不能小于 0");
  }

  if (scoreMin > scoreLimit) {
    throw new Error("单局分数下限不能大于上限");
  }

  if (scoreMin > MAX_SINGLE_SCORE) {
    throw new Error("单局分数下限不能超过 250w");
  }

  return {
    scoreMin,
    scoreLimit,
    effectiveScoreLimit: Math.min(scoreLimit, MAX_SINGLE_SCORE),
  };
}

function calculateSingle(params) {
  const multiplier = readNumber(fields.multiplier, "消耗倍数");
  const { targetPt, currentPt, basePt, bonusPercent, supportPt, scoreRatio } = params;

  if (multiplier <= 0) {
    return errorResult("倍数必须大于 0", targetPt - currentPt);
  }

  if (scoreRatio <= 0) {
    return errorResult("得分比必须大于 0", targetPt - currentPt);
  }

  const gap = targetPt - currentPt;

  if (gap < 0) {
    return warningResult(`当前 Pt 已超过目标 Pt。\n差距: ${gap}`, gap);
  }

  if (gap === 0) {
    return warningResult("当前已达到目标 Pt", gap);
  }

  if (gap > 30000) {
    return errorResult(`差距 Pt (${gap}) 超过 30000，拒绝计算。`, gap);
  }

  const validMultipliers = [1, 5, 10, 15].filter((item) => gap % item === 0);

  if (gap % multiplier !== 0) {
    return errorResult("差距 Pt 无法被当前倍数整除", gap, {
      noticeBody: "无法通过该倍数准确控分。",
      details: [
        ["差距 Pt", gap],
        ["当前倍数", `${multiplier}x`],
      ],
      tags: validMultipliers.length > 0 ? validMultipliers.map((item) => `推荐 ${item}x`) : ["无推荐倍数"],
    });
  }

  const neededSinglePt = gap / multiplier;
  const targetVal = neededSinglePt - supportPt;
  const rate = 1 + bonusPercent / 100;

  if (rate === 0) {
    return errorResult("活动加成为 -100% 时无法反推目标 Pt。", gap);
  }

  const approxX = pyInt(targetVal / rate);
  let foundX = null;

  for (let x = approxX - 10; x <= approxX + 10; x += 1) {
    if (x < basePt) continue;
    const value = x + pyInt((x * bonusPercent) / 100);
    if (value === targetVal) {
      foundX = x;
      break;
    }
  }

  if (foundX === null) {
    return errorResult("无法准确凑出目标 Pt", gap, {
      noticeBody: "请尝试调整倍数或目标。",
      details: [
        ["差距 Pt", gap],
        ["目标单局 Pt (除 support)", targetVal],
      ],
    });
  }

  const scorePtNeeded = foundX - basePt;
  const minGameScore = pyInt(scorePtNeeded * scoreRatio);
  const maxGameScore = pyInt((scorePtNeeded + 1) * scoreRatio) - 1;

  if (maxGameScore < minGameScore) {
    return errorResult("计算错误：分数范围无效 (可能得分比设置不合理)", gap);
  }

  if (minGameScore > MAX_SINGLE_SCORE) {
    return errorResult("单局所需分数超过 250w", gap, {
      noticeBody: "已拒绝计算。",
      details: [
        ["最低所需分数", minGameScore],
        ["单局分数上限", MAX_SINGLE_SCORE],
      ],
    });
  }

  const displayMinGameScore = minGameScore;
  const displayMaxGameScore = Math.min(maxGameScore, MAX_SINGLE_SCORE);
  const details = [
    ["差距 Pt", gap],
    ["单局所需 Pt (含倍数)", neededSinglePt * multiplier],
    ["单局目标 Pt (不含倍数)", neededSinglePt],
    ["所需得分 Pt", scorePtNeeded],
    ["游戏内得分下限", displayMinGameScore],
    ["游戏内得分上限", displayMaxGameScore],
  ];
  let notice = resultNotice("success", "已生成控分区间", "按当前参数可以精确凑出目标 Pt。");
  const tags = validMultipliers.map((item) => `${item}x 可用`);

  if (maxGameScore > MAX_SINGLE_SCORE) {
    notice = resultNotice("warning", "得分上限已封顶", "原始上限超过 250w，结果已按 250w 显示。");
  } else if (minGameScore > 2000000) {
    notice = resultNotice("warning", "单局分数较高", "最低所需分数超过 200w，请确认是否可以完成。");
  }

  return {
    state: notice.state,
    title: "普通模式方案",
    gap,
    notice,
    details,
    tags,
    stats: [
      ["差距 Pt", gap],
      ["单局目标 Pt", neededSinglePt],
      ["所需得分 Pt", scorePtNeeded],
      ["得分区间", formatScoreRange(displayMinGameScore, displayMaxGameScore)],
    ],
  };
}

function calculateSmart(params) {
  const { targetPt, currentPt, basePt, bonusPercent, supportPt, scoreRatio } = params;
  const { scoreMin, effectiveScoreLimit } = getScoreBounds();
  const gap = targetPt - currentPt;

  if (scoreRatio <= 0) {
    return errorResult("得分比必须大于 0", gap);
  }

  if (gap <= 0) {
    return warningResult(`无需计算 (差距 ${gap})`, gap);
  }

  if (gap > 30000) {
    return errorResult(`差距 Pt (${gap}) 超过 30000，拒绝计算。`, gap);
  }

  const ptsMap = buildPointMap(basePt, bonusPercent, supportPt, scoreRatio, scoreMin, effectiveScoreLimit);

  const ptsValues = [...ptsMap.keys()].filter((pt) => pt > 0).sort((a, b) => a - b);

  if (ptsValues.length === 0) {
    return errorResult("无法计算: 参数导致无有效 Pt 生成 (可能 ScoreLimit 太低)", gap);
  }

  const minOneGamePt = ptsValues[0];
  const maxOneGamePt = ptsValues[ptsValues.length - 1];
  if (maxOneGamePt <= 0) {
    return errorResult("无法计算: 单局最大 Pt 必须大于 0", gap);
  }

  const foundSolution = findExactMultiSolution(gap, ptsValues);

  if (foundSolution) {
    let totalCheck = 0;
    const solutionEntries = [...foundSolution.counts.entries()].sort((a, b) => b[0] - a[0]);
    const stats = [
      ["差距 Pt", gap],
      ["局数", foundSolution.games],
      ["Pt 种类", solutionEntries.length],
      ["分数下限", scoreMin],
      ["分数上限", effectiveScoreLimit],
    ];
    const solutions = [];

    solutionEntries.forEach(([ptValue, count]) => {
      const info = ptsMap.get(ptValue);
      totalCheck += ptValue * count;
      solutions.push({
        count,
        pt: ptValue,
        minScore: info.minScore,
        maxScore: info.maxScore,
      });
    });

    return {
      state: "success",
      title: "多局模式方案",
      gap,
      notice: resultNotice("success", "已找到多局方案", `${foundSolution.games} 局 0 火，校验合计 ${formatNumber(totalCheck)} Pt。`),
      details: [
        ["差距 Pt", gap],
        ["局数", foundSolution.games],
        ["校验合计", totalCheck],
        ["单局 Pt 范围", formatScoreRange(minOneGamePt, maxOneGamePt)],
        ["单局分数下限", scoreMin],
        ["单局分数上限", effectiveScoreLimit],
      ],
      solutions,
      stats,
    };
  }

  const details = [
    ["当前单局 Pt 范围", formatScoreRange(minOneGamePt, maxOneGamePt)],
    ["当前分数下限", scoreMin],
    ["当前分数上限", effectiveScoreLimit],
  ];
  const tags = [];
  const lowerGameCount = Math.max(1, Math.floor(gap / minOneGamePt));
  const lowerMaxTotal = lowerGameCount * maxOneGamePt;
  const upperMinTotal = (lowerGameCount + 1) * minOneGamePt;

  if (gap > lowerMaxTotal && gap < upperMinTotal) {
    details.push([`${lowerGameCount} 局最高`, lowerMaxTotal]);
    details.push([`${lowerGameCount + 1} 局最低`, upperMinTotal]);
  }

  const requiredPt = Math.ceil(gap / lowerGameCount);
  const required = findMinScoreForAtLeastPt(requiredPt, basePt, bonusPercent, supportPt, scoreRatio);
  if (required && required.minScore > effectiveScoreLimit) {
    details.push([`${lowerGameCount} 局单局约需`, `${formatNumber(requiredPt)} Pt`]);
    details.push(["建议分数上限至少", required.minScore]);
    tags.push(`可尝试 ${formatNumber(required.minScore)} 分以上`);
  }
  const fullPtsMap = buildPointMap(basePt, bonusPercent, supportPt, scoreRatio, scoreMin, MAX_SINGLE_SCORE);
  const fullPtsValues = [...fullPtsMap.keys()].filter((pt) => pt > 0).sort((a, b) => a - b);
  const adjustmentPlan = findExactAdjustmentPlan(gap, fullPtsValues, fullPtsMap);

  if (adjustmentPlan && adjustmentPlan.requiredScoreLimit > effectiveScoreLimit) {
    details.push(["精确方案所需上限", adjustmentPlan.requiredScoreLimit]);
    return errorResult("需要提高单局分数上限", gap, {
      noticeBody: `当前上限无精确方案；提高到 ${formatNumber(adjustmentPlan.requiredScoreLimit)} 分后可刚好获得 ${formatNumber(gap)} Pt。`,
      details,
      tags: [`${formatGameBreakdown(adjustmentPlan.games)} 完成`],
      adjustmentPlans: [adjustmentPlan],
    });
  }

  if (!adjustmentPlan) {
    tags.push("可尝试降低基本 Pt / 支援乐队 Pt / 活动加成");
  }

  return errorResult("当前分数上限内没有精确方案", gap, {
    noticeBody: "在 250w 单局上限内也没有找到精确方案；需要降低单局最低 Pt 或调整目标。",
    details,
    tags,
  });
}

function errorResult(text, gap = null, options = {}) {
  return {
    state: "error",
    title: "无法计算",
    gap,
    text,
    notice: resultNotice("error", text, options.noticeBody || ""),
    details: options.details || [],
    tags: options.tags || [],
    nearbyPlans: options.nearbyPlans || [],
    adjustmentPlans: options.adjustmentPlans || [],
    stats: [],
  };
}

function warningResult(text, gap = null, options = {}) {
  return {
    state: "warning",
    title: "无需继续计算",
    gap,
    text,
    notice: resultNotice("warning", text, options.noticeBody || ""),
    details: options.details || [],
    tags: options.tags || [],
    nearbyPlans: options.nearbyPlans || [],
    adjustmentPlans: options.adjustmentPlans || [],
    stats: [],
  };
}

function renderResult(result) {
  resultTitle.textContent = result.title;
  resultBody.className = `result-text ${result.state || "empty"}`.trim();
  resultBody.innerHTML = "";

  const notice = result.notice || resultNotice(result.state || "empty", result.text || "请填写参数并点击计算。");
  const noticeEl = document.createElement("div");
  noticeEl.className = `result-notice ${notice.state || result.state || "empty"}`;
  const label = document.createElement("span");
  label.className = "result-notice-label";
  label.textContent = {
    success: "完成",
    warning: "注意",
    error: "错误",
    empty: "待计算",
  }[notice.state || result.state] || "提示";
  const noticeText = document.createElement("div");
  const noticeTitle = document.createElement("strong");
  noticeTitle.textContent = notice.title || result.title;
  noticeText.append(noticeTitle);
  if (notice.body) {
    const noticeBody = document.createElement("p");
    noticeBody.textContent = notice.body;
    noticeText.append(noticeBody);
  }
  noticeEl.append(label, noticeText);
  resultBody.append(noticeEl);

  if (result.details && result.details.length > 0) {
    const details = document.createElement("div");
    details.className = "result-details";
    result.details.forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "result-detail-row";
      const keyEl = document.createElement("span");
      keyEl.textContent = key;
      const valueEl = document.createElement("strong");
      valueEl.textContent = displayValue(value);
      row.append(keyEl, valueEl);
      details.append(row);
    });
    resultBody.append(details);
  }

  if (result.solutions && result.solutions.length > 0) {
    const list = document.createElement("div");
    list.className = "solution-list";
    result.solutions.forEach((solution) => {
      const item = document.createElement("div");
      item.className = "solution-item";
      const main = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${formatNumber(solution.count)} 局`;
      const subtitle = document.createElement("span");
      subtitle.textContent = `获得 ${formatNumber(solution.pt)} Pt`;
      main.append(title, subtitle);
      const range = document.createElement("div");
      range.className = "solution-range";
      range.textContent = formatScoreRange(solution.minScore, solution.maxScore);
      item.append(main, range);
      list.append(item);
    });
    resultBody.append(list);
  }

  if (result.adjustmentPlans && result.adjustmentPlans.length > 0) {
    const adjustment = document.createElement("div");
    adjustment.className = "adjustment-plans";
    const heading = document.createElement("h3");
    heading.textContent = "精确调整方案";
    adjustment.append(heading);

    result.adjustmentPlans.forEach((plan) => {
      const item = document.createElement("div");
      item.className = "adjustment-plan";

      const top = document.createElement("div");
      top.className = "adjustment-plan-top";
      const summary = document.createElement("strong");
      summary.textContent = `${formatGameBreakdown(plan.games)} / ${formatNumber(plan.total)} Pt`;
      const limit = document.createElement("span");
      limit.textContent = `上限 ${formatNumber(plan.requiredScoreLimit)}`;
      top.append(summary, limit);
      item.append(top);

      const advice = document.createElement("p");
      advice.textContent = "该方案刚好达到目标 Pt；把单局分数上限提高到右侧数值后按下方分数范围控分。";
      item.append(advice);

      const lines = document.createElement("div");
      lines.className = "adjustment-plan-lines";
      plan.lines.forEach((line) => {
        const chip = document.createElement("span");
        chip.textContent = `${formatGameBreakdown(line.count)} ${formatNumber(line.pt)} Pt (${formatScoreRange(line.minScore, line.maxScore)})`;
        lines.append(chip);
      });
      item.append(lines);
      adjustment.append(item);
    });

    resultBody.append(adjustment);
  }

  if (result.nearbyPlans && result.nearbyPlans.length > 0) {
    const nearby = document.createElement("div");
    nearby.className = "nearby-plans";
    const heading = document.createElement("h3");
    heading.textContent = "相似结果";
    nearby.append(heading);

    result.nearbyPlans.forEach((plan) => {
      const item = document.createElement("div");
      item.className = "nearby-plan";

      const top = document.createElement("div");
      top.className = "nearby-plan-top";
      const summary = document.createElement("strong");
      summary.textContent = `${formatNumber(plan.total)} Pt / ${formatNumber(plan.games)} 局`;
      const delta = document.createElement("span");
      delta.className = plan.delta > 0 ? "delta-positive" : "delta-negative";
      delta.textContent = plan.delta > 0 ? `高于目标 ${formatNumber(plan.delta)} Pt` : `低于目标 ${formatNumber(Math.abs(plan.delta))} Pt`;
      top.append(summary, delta);
      item.append(top);

      const advice = document.createElement("p");
      advice.textContent = "该总 Pt 可达成；每局可按下方 Pt 与分数范围控分。";
      item.append(advice);

      const lines = document.createElement("div");
      lines.className = "nearby-plan-lines";
      plan.lines.forEach((line) => {
        const chip = document.createElement("span");
        chip.textContent = `${formatNumber(line.count)} 局 ${formatNumber(line.pt)} Pt (${formatScoreRange(line.minScore, line.maxScore)})`;
        lines.append(chip);
      });
      item.append(lines);
      nearby.append(item);
    });

    resultBody.append(nearby);
  }

  if (result.tags && result.tags.length > 0) {
    const tags = document.createElement("div");
    tags.className = "result-tags";
    result.tags.forEach((item) => {
      const tag = document.createElement("span");
      tag.textContent = item;
      tags.append(tag);
    });
    resultBody.append(tags);
  }

  statGrid.innerHTML = "";
  if (result.stats && result.stats.length > 0) {
    result.stats.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "stat";
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("strong");
      val.textContent = displayValue(value);
      item.append(key, val);
      statGrid.append(item);
    });
    statGrid.hidden = false;
  } else {
    statGrid.hidden = true;
  }
}

function updateModeUi() {
  const isSmart = fields.smartMode.checked;
  const activeMode = isSmart ? "multi" : "single";

  modeNote.textContent = isSmart ? "按单局分数区间精确搜索 0 火组合" : "按选择倍数反推单局分数区间";
  singleModeControls.hidden = isSmart;
  multiModeControls.hidden = !isSmart;

  modeTabs.forEach((button) => {
    const active = button.dataset.mode === activeMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncMultiplierButtons() {
  const value = fields.multiplier.value;
  multiplierButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.multiplier === value);
  });
}

function openAboutDialog() {
  aboutDialog.hidden = false;
  document.body.classList.add("modal-open");
  aboutClose.focus();
}

function closeAboutDialog() {
  aboutDialog.hidden = true;
  document.body.classList.remove("modal-open");
  moreButton.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const params = getBaseParams();
    const result = fields.smartMode.checked ? calculateSmart(params) : calculateSingle(params);
    renderResult(result);
  } catch (error) {
    renderResult(errorResult(error.message));
  }
});

fields.smartMode.addEventListener("change", updateModeUi);
fields.multiplier.addEventListener("input", syncMultiplierButtons);
modeTabs.forEach((button) => {
  button.addEventListener("click", () => {
    fields.smartMode.checked = button.dataset.mode === "multi";
    updateModeUi();
  });
});
moreButton.addEventListener("click", openAboutDialog);
aboutClose.addEventListener("click", closeAboutDialog);
aboutDialog.addEventListener("click", (event) => {
  if (event.target === aboutDialog) closeAboutDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !aboutDialog.hidden) closeAboutDialog();
});

multiplierButtons.forEach((button) => {
  button.addEventListener("click", () => {
    fields.multiplier.value = button.dataset.multiplier;
    syncMultiplierButtons();
  });
});

resetBtn.addEventListener("click", () => {
  form.reset();
  fields.scoreRatio.value = "15000";
  fields.multiplier.value = "1";
  fields.scoreMin.value = "0";
  fields.scoreLimit.value = "500000";
  renderResult({
    state: "",
    title: "等待输入",
    gap: null,
    text: "请填写参数并点击计算。",
    stats: [],
  });
  syncMultiplierButtons();
  updateModeUi();
});

syncMultiplierButtons();
updateModeUi();
