"use strict";

const state = {
  session: null,
  csrfToken: "",
  selectedAccount: null,
  selectedCharacter: null,
  character: null,
  selectedResource: null,
  playerPage: 1,
  resourcePage: 1,
  logPage: 1,
  pendingOperation: null,
  confirmingOperation: false,
  accessRecord: null,
};

const labels = {
  currency: "货币",
  card: "卡牌",
  item: "物品",
  silver: "银币",
  gold: "金币",
  crystal: "晶石",
  players: "玩家查询",
  resources: "资源目录",
  logs: "日志",
};

const permissionKeys = ["players", "resources", "logs", "currency", "card", "item"];
const limitKeys = ["silver", "gold", "crystal", "card", "item"];
const maxLimits = Object.freeze({ silver: 1000000, gold: 10000, crystal: 10000, card: 100, item: 1000 });
const pendingStoragePrefix = "tianxu-gm-pending-v1:";
const $ = (id) => document.getElementById(id);

class ApiError extends Error {
  constructor(status, payload) {
    super(payload && payload.error ? payload.error : `请求失败（${status}）`);
    this.status = status;
    this.payload = payload || {};
  }
}

function setMessage(element, text, type = "") {
  element.textContent = text || "";
  element.className = `message${type ? ` ${type}` : ""}`;
}

function clearNode(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError(response.status || 500, { error: "服务器返回了无法识别的数据" }); }
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD" && path !== "/api/gm/login" && state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  const payload = await parseResponse(response);
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

function showOnly(view) {
  for (const id of ["loginView", "deniedView", "appView"]) $(id).hidden = id !== view;
}

function showDenied(accountId) {
  clearSession();
  $("deniedAccountId").textContent = accountId || "服务器未提供";
  showOnly("deniedView");
}

function clearSession() {
  state.session = null;
  state.csrfToken = "";
  state.selectedAccount = null;
  state.selectedCharacter = null;
  state.character = null;
  state.selectedResource = null;
  state.pendingOperation = null;
  state.confirmingOperation = false;
  state.accessRecord = null;
  $("loginPassword").value = "";
  renderOperation();
}

function pendingStorageKey(accountId) {
  return pendingStoragePrefix + String(accountId);
}

function validPendingPayload(kind, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !/^[A-Za-z0-9_-]{8,100}$/.test(String(payload.operationId || ""))) return false;
  if (typeof payload.targetAccountId !== "string" || !payload.targetAccountId || typeof payload.reason !== "string" || !payload.reason) return false;
  if (kind === "grant") {
    return typeof payload.targetCharacterId === "string" && Boolean(payload.targetCharacterId)
      && ["currency", "card", "item"].includes(payload.type)
      && typeof payload.resourceId === "string" && Boolean(payload.resourceId)
      && Number.isSafeInteger(payload.quantity) && payload.quantity > 0;
  }
  if (kind === "access") {
    if (!["player", "gm", "super_admin"].includes(payload.role) || !payload.permissions || !payload.limits) return false;
    if (Object.keys(payload.permissions).sort().join(",") !== [...permissionKeys].sort().join(",")
      || Object.keys(payload.limits).sort().join(",") !== [...limitKeys].sort().join(",")) return false;
    return permissionKeys.every((key) => typeof payload.permissions[key] === "boolean")
      && limitKeys.every((key) => Number.isSafeInteger(payload.limits[key]) && payload.limits[key] >= 0 && payload.limits[key] <= maxLimits[key]);
  }
  return false;
}

function freezePendingPayload(kind, payload) {
  if (kind === "access") return Object.freeze({ ...payload, permissions: Object.freeze({ ...payload.permissions }), limits: Object.freeze({ ...payload.limits }) });
  return Object.freeze({ ...payload });
}

function persistPendingOperation(operation) {
  try {
    const record = {
      version: 1,
      ownerAccountId: operation.ownerAccountId,
      kind: operation.kind,
      operationId: operation.payload.operationId,
      payload: operation.payload,
      summary: operation.summary,
    };
    sessionStorage.setItem(pendingStorageKey(operation.ownerAccountId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function restorePendingOperation(accountId) {
  state.pendingOperation = null;
  let record;
  try {
    const raw = sessionStorage.getItem(pendingStorageKey(accountId));
    if (!raw) { renderOperation(); return; }
    record = JSON.parse(raw);
  } catch {
    renderOperation();
    return;
  }
  const expectedPath = record && record.kind === "grant" ? "/api/gm/grants" : record && record.kind === "access" ? "/api/gm/access" : "";
  const summaryValid = Array.isArray(record && record.summary) && record.summary.length > 0 && record.summary.length <= 20
    && record.summary.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((value) => ["string", "number", "boolean"].includes(typeof value)));
  if (!record || record.version !== 1 || record.ownerAccountId !== accountId || record.operationId !== record.payload?.operationId
    || !expectedPath || !summaryValid || !validPendingPayload(record.kind, record.payload)) {
    renderOperation();
    return;
  }
  state.pendingOperation = {
    ownerAccountId: accountId,
    kind: record.kind,
    path: expectedPath,
    payload: freezePendingPayload(record.kind, record.payload),
    summary: Object.freeze(record.summary.map((pair) => Object.freeze([...pair]))),
    status: "unknown",
    message: "已恢复本账号刷新前未确认的操作。不会自动提交，请查询原操作或按原内容重试。",
    canRetry: true,
    canClose: false,
  };
  renderOperation();
}

function clearPendingMetadata(operation) {
  try { sessionStorage.removeItem(pendingStorageKey(operation.ownerAccountId)); } catch { /* 页面状态仍会清空。 */ }
}

function applySession(data) {
  state.session = data;
  state.csrfToken = data.csrfToken || "";
  const account = data.account || {};
  if (!availableTabs().length) {
    showDenied(account.id);
    return;
  }
  $("accountSummary").textContent = `${account.username || account.id || "管理员"} · ${account.role || "gm"}`;
  restorePendingOperation(account.id);
  buildTabs();
  showOnly("appView");
}

function availableTabs() {
  const p = state.session.permissions || {};
  const tabs = [];
  if (p.players && p.resources && ["currency", "card", "item"].some((key) => p[key])) tabs.push({ id: "grant", name: "资源发放" });
  if (p.manageGm) tabs.push({ id: "access", name: "权限管理" });
  if (p.logs) tabs.push({ id: "logs", name: "操作日志" });
  return tabs;
}

function buildTabs() {
  const nav = $("tabNav");
  clearNode(nav);
  const tabs = availableTabs();
  for (const tab of tabs) {
    const button = el("button", tab.name, "tab-button");
    button.type = "button";
    button.dataset.tab = tab.id;
    button.addEventListener("click", () => activateTab(tab.id));
    nav.appendChild(button);
  }
  if (tabs.length) activateTab(tabs[0].id);
}

function activateTab(tabId) {
  for (const panel of ["grant", "access", "logs"]) $(`${panel}Tab`).hidden = panel !== tabId;
  for (const button of $("tabNav").querySelectorAll("button")) button.classList.toggle("active", button.dataset.tab === tabId);
  if (tabId === "grant" && !$("playerRows").children.length) loadPlayers(1);
  if (tabId === "logs" && !$("logRows").children.length) loadLogs(1);
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== "" && value !== undefined && value !== null) search.set(key, String(value));
  return search.toString();
}

function makePager(container, page, pageSize, total, onPage) {
  clearNode(container);
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  const previous = el("button", "上一页");
  previous.type = "button";
  previous.disabled = page <= 1;
  previous.addEventListener("click", () => onPage(page - 1));
  const summary = el("span", `第 ${page} / ${pages} 页，共 ${total || 0} 条`);
  const next = el("button", "下一页");
  next.type = "button";
  next.disabled = page >= pages;
  next.addEventListener("click", () => onPage(page + 1));
  container.append(previous, summary, next);
}

async function loadPlayers(page) {
  state.playerPage = page;
  setMessage($("playerMessage"), "正在查询…");
  clearNode($("playerRows"));
  try {
    const q = $("playerQuery").value.trim();
    const data = await api(`/api/gm/players?${queryString({ q, page, pageSize: 20 })}`);
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    for (const account of accounts) renderPlayerRow(account);
    setMessage($("playerMessage"), accounts.length ? "" : "没有找到匹配账号。", accounts.length ? "" : "error");
    makePager($("playerPager"), Number(data.page || page), Number(data.pageSize || 20), Number(data.total || 0), loadPlayers);
  } catch (error) {
    setMessage($("playerMessage"), error.message, "error");
  }
}

function renderPlayerRow(account) {
  const row = document.createElement("tr");
  const accountCell = document.createElement("td");
  accountCell.append(el("strong", account.username || "未命名账号"), el("span", `ID：${account.id}`, "subline"));
  const characters = Array.isArray(account.characters) ? account.characters : [];
  const characterCell = document.createElement("td");
  const actionCell = document.createElement("td");
  actionCell.className = "character-actions";
  if (!characters.length) {
    characterCell.textContent = "该账号尚未创建角色";
    actionCell.textContent = "不能发放角色资源";
  } else {
    characterCell.textContent = characters.map((character) => `${character.name}（Lv.${character.level}）`).join("、");
    for (const character of characters) {
      const button = el("button", `选择 ${character.name}`);
      button.type = "button";
      button.addEventListener("click", () => selectCharacter(account, character));
      actionCell.appendChild(button);
    }
  }
  row.append(accountCell, characterCell, actionCell);
  $("playerRows").appendChild(row);
}

async function selectCharacter(account, character) {
  setMessage($("playerMessage"), `正在读取 ${character.name}…`);
  try {
    const data = await api(`/api/gm/character?${queryString({ accountId: account.id, characterId: character.id })}`);
    state.selectedAccount = account;
    state.selectedCharacter = character;
    state.character = data;
    state.selectedResource = null;
    $("selectedResourceLabel").value = "";
    $("grantEditor").hidden = false;
    $("selectedTarget").textContent = `账号 ${account.username || account.id} → 角色 ${data.name || character.name}（${data.characterId || character.id}）`;
    renderCharacterSnapshot(data);
    buildResourceTypes();
    setMessage($("playerMessage"), "已选择明确角色。", "success");
    await loadResources(1);
    $("grantEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setMessage($("playerMessage"), error.message, "error");
  }
}

function renderCharacterSnapshot(data) {
  const box = $("characterSnapshot");
  clearNode(box);
  const grid = el("div", null, "snapshot-grid");
  const pairs = [["角色", data.name || data.characterId], ["等级", data.level], ...Object.entries(data.currencies || {}).map(([key, value]) => [labels[key] || key, value])];
  for (const [name, value] of pairs) {
    const item = document.createElement("div");
    item.append(el("span", name, "subline"), el("strong", value));
    grid.appendChild(item);
  }
  box.appendChild(grid);
}

function buildResourceTypes() {
  const select = $("resourceType");
  const current = select.value;
  clearNode(select);
  const permissions = state.session.permissions || {};
  for (const type of ["currency", "card", "item"]) {
    if (!permissions[type]) continue;
    const option = el("option", labels[type]);
    option.value = type;
    select.appendChild(option);
  }
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

async function loadResources(page) {
  state.resourcePage = page;
  state.selectedResource = null;
  $("selectedResourceLabel").value = "";
  setMessage($("resourceMessage"), "正在查询资源…");
  clearNode($("resourceList"));
  try {
    const type = $("resourceType").value;
    const q = $("resourceQuery").value.trim();
    const data = await api(`/api/gm/resources?${queryString({ type, q, page, pageSize: 40 })}`);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const button = el("button", `${item.name || item.resourceId} · ${item.resourceId}`, "resource-item");
      button.type = "button";
      button.addEventListener("click", () => selectResource(item, button));
      $("resourceList").appendChild(button);
    }
    setMessage($("resourceMessage"), items.length ? "" : "没有找到匹配资源。", items.length ? "" : "error");
    makePager($("resourcePager"), Number(data.page || page), Number(data.pageSize || 40), Number(data.total || 0), loadResources);
  } catch (error) {
    setMessage($("resourceMessage"), error.message, "error");
  }
}

function selectResource(item, button) {
  state.selectedResource = item;
  for (const node of $("resourceList").querySelectorAll("button")) node.classList.remove("selected");
  button.classList.add("selected");
  $("selectedResourceLabel").value = `${item.name || item.resourceId}（${item.resourceId}）`;
  const limitKey = item.type === "currency" ? item.resourceId : item.type;
  const limit = state.session.limits ? state.session.limits[limitKey] : undefined;
  $("grantQuantity").max = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? String(limit) : "";
  $("grantLimitHint").textContent = limit !== undefined ? `本账号该类单次上限：${limit}` : "";
}

function collectionAmount(collection, resourceId) {
  if (Array.isArray(collection)) {
    const found = collection.find((entry) => String(entry.resourceId ?? entry.id ?? entry.cardId ?? entry.itemId) === String(resourceId));
    return Number(found ? found.quantity ?? found.count ?? found.amount ?? 0 : 0);
  }
  if (collection && typeof collection === "object") return Number(collection[resourceId] ?? 0);
  return 0;
}

function currentResourceAmount(resource) {
  if (!state.character) return 0;
  if (resource.type === "currency") return Number((state.character.currencies || {})[resource.resourceId] ?? 0);
  return collectionAmount(resource.type === "card" ? state.character.cards : state.character.inventory, resource.resourceId);
}

function displayValue(value) {
  if (value === undefined || value === null) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function newOperationId() {
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function showConfirmation(title, entries) {
  return new Promise((resolve) => {
    $("confirmTitle").textContent = title;
    clearNode($("confirmDetails"));
    for (const [name, value] of entries) {
      const row = el("div", null, "confirm-row");
      row.append(el("span", name), el("strong", value));
      $("confirmDetails").appendChild(row);
    }
    const dialog = $("confirmDialog");
    const close = () => {
      dialog.removeEventListener("close", close);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.addEventListener("close", close);
    dialog.showModal();
  });
}

async function prepareGrant(event) {
  event.preventDefault();
  if (state.pendingOperation || state.confirmingOperation) return;
  if (!state.selectedAccount || !state.selectedCharacter || !state.selectedResource || !state.character) {
    setMessage($("resourceMessage"), "请先选择明确的账号、角色和资源。", "error");
    return;
  }
  const quantity = Number($("grantQuantity").value);
  const reason = $("grantReason").value.trim();
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !reason) {
    setMessage($("resourceMessage"), "增加数量必须是正整数，并填写操作原因。", "error");
    return;
  }
  const resource = { ...state.selectedResource };
  const limitKey = resource.type === "currency" ? resource.resourceId : resource.type;
  const limit = state.session.limits ? Number(state.session.limits[limitKey]) : NaN;
  if (Number.isFinite(limit) && quantity > limit) {
    setMessage($("resourceMessage"), `增加数量超过本账号单次上限 ${limit}。`, "error");
    return;
  }
  const before = currentResourceAmount(resource);
  const payload = {
    operationId: newOperationId(),
    targetAccountId: state.selectedAccount.id,
    targetCharacterId: state.character.characterId || state.selectedCharacter.id,
    type: resource.type,
    resourceId: resource.resourceId,
    quantity,
    reason,
  };
  const entries = [["目标账号", `${state.selectedAccount.username || ""}（${payload.targetAccountId}）`], ["目标角色", `${state.character.name || ""}（${payload.targetCharacterId}）`], ["资源", `${resource.name || resource.resourceId}（${resource.resourceId}）`], ["操作", `增加 ${quantity}`], ["当前数量", before], ["增加后目标", before + quantity], ["原因", reason]];
  state.confirmingOperation = true;
  let confirmed;
  try { confirmed = await showConfirmation("确认增加资源", entries); }
  finally { state.confirmingOperation = false; }
  if (!confirmed || state.pendingOperation) return;
  state.pendingOperation = { ownerAccountId: state.session.account.id, kind: "grant", path: "/api/gm/grants", payload: Object.freeze({ ...payload }), summary: Object.freeze(entries.map((pair) => Object.freeze([...pair]))), status: "processing", message: "正在提交…", canRetry: false, canClose: false };
  if (!persistPendingOperation(state.pendingOperation)) {
    state.pendingOperation = null;
    renderOperation();
    setMessage($("resourceMessage"), "浏览器无法保存待确认操作，本次未提交。请检查会话存储设置后重试。", "error");
    return;
  }
  renderOperation();
  await submitFrozenOperation();
}

async function submitFrozenOperation() {
  const operation = state.pendingOperation;
  if (!operation || operation.submitting || operation.querying) return;
  operation.submitting = true;
  operation.status = "processing";
  operation.message = "正在提交原操作，请勿重复点击。";
  operation.canRetry = false;
  operation.canClose = false;
  renderOperation();
  try {
    const result = await api(operation.path, { method: "POST", body: JSON.stringify(operation.payload) });
    operation.result = result;
    if (result.result === "success") {
      operation.status = "success";
      operation.message = `操作成功${result.replayed ? "（服务器返回原操作结果）" : ""}`;
      operation.canClose = true;
      operation.canRetry = false;
      if (operation.kind === "grant") await refreshSelectedCharacter();
    } else {
      operation.status = "unknown";
      operation.message = "提交响应未确认成功。请查询原操作；只有原回执明确拒绝后才能结束。";
      operation.canClose = false;
      operation.canRetry = true;
    }
  } catch (error) {
    const code = error.payload && error.payload.code ? `（${error.payload.code}）` : "";
    const explicitlyUnknown = error instanceof TypeError || (error instanceof ApiError && (error.status === 408 || error.status >= 500));
    operation.status = "unknown";
    operation.message = explicitlyUnknown
      ? `${error.message || "网络中断"}${code}，结果尚不明确。请查询原操作，或按完全相同的内容重试。`
      : `${error.message}${code}。请查询原操作确认拒绝回执；未确认前只能按原内容重试。`;
    operation.canRetry = true;
    operation.canClose = false;
  }
  operation.submitting = false;
  renderOperation();
}

async function refreshSelectedCharacter() {
  if (!state.selectedAccount || !state.selectedCharacter) return;
  try {
    state.character = await api(`/api/gm/character?${queryString({ accountId: state.selectedAccount.id, characterId: state.selectedCharacter.id })}`);
    renderCharacterSnapshot(state.character);
  } catch { /* 成功结果本身已经确定，快照刷新失败不改变操作结论。 */ }
}

async function queryPendingOperation() {
  const operation = state.pendingOperation;
  if (!operation || operation.querying || operation.submitting) return;
  operation.querying = true;
  operation.message = "正在查询原操作…";
  renderOperation();
  try {
    const data = await api(`/api/gm/operations/${encodeURIComponent(operation.payload.operationId)}`);
    const result = data.operation || {};
    operation.result = result;
    if (result.result === "success" || result.result === "rejected") {
      operation.status = result.result === "success" ? "success" : "error";
      operation.message = result.result === "success" ? "已确认原操作成功。" : "已确认原操作被拒绝。";
      operation.canRetry = false;
      operation.canClose = true;
      if (operation.kind === "grant" && result.result === "success") await refreshSelectedCharacter();
    } else {
      operation.status = "unknown";
      operation.message = "服务器回执状态无法识别。原操作号和内容仍已冻结，请继续查询或按原内容重试。";
      operation.canRetry = true;
      operation.canClose = false;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      operation.status = "unknown";
      operation.message = "服务器尚未找到该操作。可继续查询，或使用相同操作号和原内容重试。";
      operation.canRetry = true;
      operation.canClose = false;
    } else {
      operation.status = "unknown";
      operation.message = `查询失败：${error.message}。原操作号和内容仍已保留。`;
      operation.canRetry = true;
      operation.canClose = false;
    }
  }
  operation.querying = false;
  renderOperation();
}

function renderOperation() {
  const panel = $("operationPanel");
  clearNode(panel);
  const operation = state.pendingOperation;
  if (!operation) { panel.hidden = true; setFormsDisabled(false); return; }
  panel.hidden = false;
  panel.className = `operation-panel${operation.status === "success" ? " success" : operation.status === "error" ? " error" : ""}`;
  const heading = el("div", null, "operation-title");
  heading.append(el("strong", operation.message), el("span", `操作号：${operation.payload.operationId}`, "subline"));
  panel.appendChild(heading);
  const data = el("div", null, "operation-data");
  for (const [name, value] of operation.summary) {
    const item = document.createElement("div");
    item.append(el("span", name, "subline"), el("strong", value));
    data.appendChild(item);
  }
  if (operation.result && (operation.result.before !== undefined || operation.result.after !== undefined)) {
    const resultItem = document.createElement("div");
    resultItem.append(el("span", "服务器结果", "subline"), el("strong", `${displayValue(operation.result.before)} → ${displayValue(operation.result.after)}`));
    data.appendChild(resultItem);
  }
  panel.appendChild(data);
  const actions = el("div", null, "operation-actions");
  const query = el("button", "查询原操作");
  query.type = "button";
  query.disabled = operation.status === "processing" || operation.querying || operation.submitting;
  query.addEventListener("click", queryPendingOperation);
  actions.appendChild(query);
  if (operation.canRetry) {
    const retry = el("button", "按原内容重试");
    retry.type = "button";
    retry.disabled = operation.querying || operation.submitting;
    retry.addEventListener("click", submitFrozenOperation);
    actions.appendChild(retry);
  }
  if (operation.canClose) {
    const close = el("button", "结束本次操作");
    close.type = "button";
    close.addEventListener("click", () => { clearPendingMetadata(operation); state.pendingOperation = null; renderOperation(); });
    actions.appendChild(close);
  }
  panel.appendChild(actions);
  setFormsDisabled(true);
}

function setFormsDisabled(disabled) {
  for (const formId of ["grantForm", "accessForm"]) {
    for (const control of $(formId).querySelectorAll("input, select, textarea, button")) control.disabled = disabled;
  }
}

async function loadAccess(event) {
  event.preventDefault();
  const accountId = $("accessAccountId").value.trim();
  setMessage($("accessMessage"), "正在读取…");
  $("accessForm").hidden = true;
  try {
    const data = await api(`/api/gm/access?${queryString({ accountId })}`);
    state.accessRecord = data;
    renderAccess(data);
    setMessage($("accessMessage"), "已读取当前权限。", "success");
  } catch (error) {
    setMessage($("accessMessage"), error.message, "error");
  }
}

function renderAccess(data) {
  const current = $("accessCurrent");
  clearNode(current);
  const account = data.account || {};
  const access = data.access || {};
  current.append(el("strong", `${account.username || "未命名账号"}（${account.id || $("accessAccountId").value.trim()}）`), el("span", `当前角色：${access.role || "player"} · 修订号：${access.revision ?? "未提供"}`, "subline"));
  $("accessRole").value = access.role || "player";
  clearNode($("accessPermissions"));
  for (const key of permissionKeys) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = key;
    input.checked = Boolean((access.permissions || {})[key]);
    label.append(input, document.createTextNode(labels[key] || labels[key.replace(/^./, (c) => c)] || key));
    $("accessPermissions").appendChild(label);
  }
  clearNode($("accessLimits"));
  for (const key of limitKeys) {
    const label = document.createElement("label");
    label.appendChild(el("span", labels[key] || key));
    const input = document.createElement("input");
    input.type = "number";
    input.name = key;
    input.min = "0";
    input.step = "1";
    input.required = true;
    input.value = String((access.limits || {})[key] ?? 0);
    label.appendChild(input);
    $("accessLimits").appendChild(label);
  }
  $("accessReason").value = "";
  $("accessForm").hidden = false;
}

async function prepareAccess(event) {
  event.preventDefault();
  if (!state.accessRecord || state.pendingOperation || state.confirmingOperation) return;
  const account = state.accessRecord.account || {};
  const selectedPermissions = {};
  for (const input of $("accessPermissions").querySelectorAll("input")) selectedPermissions[input.name] = input.checked;
  const selectedLimits = {};
  for (const input of $("accessLimits").querySelectorAll("input")) {
    const value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < 0) { setMessage($("accessMessage"), "权限上限必须是非负整数。", "error"); return; }
    selectedLimits[input.name] = value;
  }
  const reason = $("accessReason").value.trim();
  if (!reason) { setMessage($("accessMessage"), "请填写修改原因。", "error"); return; }
  const role = $("accessRole").value;
  const permissions = role === "super_admin" ? Object.fromEntries(permissionKeys.map((key) => [key, true]))
    : role === "player" ? Object.fromEntries(permissionKeys.map((key) => [key, false])) : selectedPermissions;
  const limits = role === "super_admin" ? { ...maxLimits }
    : role === "player" ? Object.fromEntries(limitKeys.map((key) => [key, 0])) : selectedLimits;
  const payload = { operationId: newOperationId(), targetAccountId: account.id || $("accessAccountId").value.trim(), role, permissions, limits, reason };
  const currentAccess = state.accessRecord.access || {};
  const currentEnabled = Object.entries(currentAccess.permissions || {}).filter(([, value]) => value).map(([key]) => labels[key] || key).join("、") || "无";
  const currentLimits = limitKeys.map((key) => `${labels[key] || key} ${(currentAccess.limits || {})[key] ?? 0}`).join("；");
  const enabled = Object.entries(permissions).filter(([, value]) => value).map(([key]) => labels[key] || key).join("、") || "无";
  const limitSummary = limitKeys.map((key) => `${labels[key] || key} ${limits[key]}`).join("；");
  const normalizedRule = role === "super_admin" ? "超级管理员由服务器设为全部权限和最高上限" : role === "player" ? "普通玩家由服务器清空全部管理权限和上限" : "按本次填写值保存";
  const entries = [["目标账号", `${account.username || ""}（${payload.targetAccountId}）`], ["当前角色", currentAccess.role || "player"], ["目标角色", payload.role], ["服务端规则", normalizedRule], ["当前权限", currentEnabled], ["目标权限", enabled], ["当前上限", currentLimits], ["目标上限", limitSummary], ["原因", reason]];
  state.confirmingOperation = true;
  let confirmed;
  try { confirmed = await showConfirmation("确认修改管理员权限", entries); }
  finally { state.confirmingOperation = false; }
  if (!confirmed || state.pendingOperation) return;
  state.pendingOperation = { ownerAccountId: state.session.account.id, kind: "access", path: "/api/gm/access", payload: freezePendingPayload("access", payload), summary: Object.freeze(entries.map((pair) => Object.freeze([...pair]))), status: "processing", message: "正在提交…", canRetry: false, canClose: false };
  if (!persistPendingOperation(state.pendingOperation)) {
    state.pendingOperation = null;
    renderOperation();
    setMessage($("accessMessage"), "浏览器无法保存待确认操作，本次未提交。请检查会话存储设置后重试。", "error");
    return;
  }
  renderOperation();
  await submitFrozenOperation();
}

function logParams() {
  const form = new FormData($("logFilterForm"));
  const params = {};
  for (const [key, value] of form.entries()) {
    if (!value) continue;
    params[key] = (key === "from" || key === "to") ? new Date(value).toISOString() : value;
  }
  return params;
}

async function loadLogs(page) {
  state.logPage = page;
  setMessage($("logMessage"), "正在读取日志…");
  clearNode($("logRows"));
  try {
    const data = await api(`/api/gm/logs?${queryString({ ...logParams(), page, pageSize: 20 })}`);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) renderLogRow(item);
    setMessage($("logMessage"), items.length ? "" : "没有符合条件的日志。", items.length ? "" : "error");
    makePager($("logPager"), Number(data.page || page), Number(data.pageSize || 20), Number(data.total || 0), loadLogs);
  } catch (error) {
    setMessage($("logMessage"), error.message, "error");
  }
}

function renderLogRow(item) {
  const row = document.createElement("tr");
  const time = document.createElement("td");
  time.append(el("span", item.serverTime ? new Date(item.serverTime).toLocaleString("zh-CN") : "-"), el("span", item.operationId || "-", "subline"));
  const actors = document.createElement("td");
  actors.append(el("span", item.operatorAccountId || "-"), el("span", `→ ${item.targetAccountId || "-"}${item.targetCharacterId ? ` / ${item.targetCharacterId}` : ""}`, "subline"));
  const resource = document.createElement("td");
  resource.append(el("span", item.action || "-"), el("span", `${labels[item.type] || item.type || "-"} / ${item.resourceId || "-"}`, "subline"));
  const change = el("td", `${item.before ?? "-"} → ${item.after ?? "-"}${item.quantity !== undefined ? `（+${item.quantity}）` : ""}`);
  const result = document.createElement("td");
  result.append(el("span", item.reason || "-"), el("span", `${item.result || "-"}${item.errorCode ? ` · ${item.errorCode}` : ""}`, item.result === "success" ? "result-success" : "result-rejected"));
  row.append(time, actors, resource, change, result);
  $("logRows").appendChild(row);
}

function bindEvents() {
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage($("loginMessage"), "正在登录…");
    try {
      const data = await api("/api/gm/login", { method: "POST", body: JSON.stringify({ username: $("loginUsername").value.trim(), password: $("loginPassword").value }) });
      $("loginPassword").value = "";
      applySession(data);
    } catch (error) {
      $("loginPassword").value = "";
      if (error instanceof ApiError && error.status === 403 && error.payload.accountId) showDenied(error.payload.accountId);
      else setMessage($("loginMessage"), error.message, "error");
    }
  });
  $("deniedBack").addEventListener("click", () => { clearSession(); showOnly("loginView"); });
  $("logoutButton").addEventListener("click", async () => {
    try { await api("/api/gm/logout", { method: "POST", body: "{}" }); } catch { /* 本地仍清空内存会话。 */ }
    clearSession();
    showOnly("loginView");
  });
  $("playerSearchForm").addEventListener("submit", (event) => { event.preventDefault(); loadPlayers(1); });
  $("resourceSearchForm").addEventListener("submit", (event) => { event.preventDefault(); loadResources(1); });
  $("resourceType").addEventListener("change", () => loadResources(1));
  $("grantForm").addEventListener("submit", prepareGrant);
  $("accessLookupForm").addEventListener("submit", loadAccess);
  $("accessForm").addEventListener("submit", prepareAccess);
  $("logFilterForm").addEventListener("submit", (event) => { event.preventDefault(); loadLogs(1); });
  $("resetLogs").addEventListener("click", () => { $("logFilterForm").reset(); loadLogs(1); });
}

async function boot() {
  bindEvents();
  try {
    const data = await api("/api/gm/session");
    applySession(data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && error.payload.accountId) showDenied(error.payload.accountId);
    else showOnly("loginView");
  }
}

boot();
