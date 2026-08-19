import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ButtonModel,
  LabelModel,
  ListModel,
  ModalModel,
  ResourceBarModel,
  TabsModel,
  ToastQueueModel,
  UiContractError,
} from '../assets/scripts/ui/index.ts';

const source = fs.readFileSync(new URL('../assets/scripts/ui/index.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|require\()\s*["'](?:node:|cc)/, 'UI models must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|setTimeout|setInterval)\b/, 'UI models must not require DOM or timers');
assert.match(source, /export class (?:ButtonModel|LabelModel|ResourceBarModel|ModalModel|ListModel|TabsModel|ToastQueueModel)/);

function errorCode(error, code) {
  return error instanceof UiContractError && error.code === code;
}

function rejects(action, code) {
  assert.throws(action, (error) => errorCode(error, code), `expected ${code}`);
}

function immutable(value) {
  assert.equal(Object.isFrozen(value), true);
  assert.doesNotThrow(() => JSON.stringify(value));
}

function cannotMutate(value, mutate) {
  assert.throws(() => mutate(value), TypeError);
}

// Label: exact boundary is accepted, overlong and invalid values are rejected atomically.
const label = new LabelModel({ id: 'title', text: '四字标签', maxLength: 4 });
assert.equal(label.snapshot.length, 4);
label.setText('');
assert.equal(label.snapshot.text, '');
label.setText('四字标签');
const labelBefore = label.snapshot;
rejects(() => label.setText('五字标签超长'), 'TEXT_TOO_LONG');
assert.strictEqual(label.snapshot, labelBefore);
rejects(() => new LabelModel({ id: 'bad', text: 'x', maxLength: 0 }), 'INVALID_NUMBER');
rejects(() => label.setText(3), 'INVALID_TEXT');
immutable(label.snapshot);
cannotMutate(label.snapshot, (state) => { state.text = '绕过'; });

// Button: disabled input, duplicate event delivery, and re-entrant callbacks never double-run.
let buttonCalls = 0;
let nestedResult;
let button;
button = new ButtonModel({
  id: 'claim',
  label: '领取',
  onClick: () => {
    buttonCalls += 1;
    nestedResult = button.click('evt-1');
  },
});
assert.deepEqual(button.click('evt-1'), { accepted: true, reason: 'triggered' });
assert.deepEqual(nestedResult, { accepted: false, reason: 'reentrant' });
assert.deepEqual(button.click('evt-1'), { accepted: false, reason: 'duplicate-event' });
assert.equal(buttonCalls, 1);
button.setDisabled(true);
assert.deepEqual(button.click('evt-2'), { accepted: false, reason: 'disabled' });
assert.equal(button.snapshot.clickCount, 1);
const buttonBefore = button.snapshot;
rejects(() => button.setDisabled('yes'), 'INVALID_BOOLEAN');
assert.strictEqual(button.snapshot, buttonBefore);
rejects(() => button.click(''), 'INVALID_ID');
immutable(button.snapshot);
cannotMutate(button.snapshot, (state) => { state.disabled = false; });

// Resource bar: values are capped by max; negative and non-finite values are refused.
const resource = new ResourceBarModel({ id: 'stamina', value: 120, max: 100 });
assert.deepEqual(resource.snapshot, { id: 'stamina', value: 100, max: 100, ratio: 1 });
const resourceBefore = resource.snapshot;
rejects(() => resource.setValue(-1), 'INVALID_NUMBER');
assert.strictEqual(resource.snapshot, resourceBefore);
rejects(() => resource.setValue(Number.NaN), 'INVALID_NUMBER');
resource.setMax(40);
assert.deepEqual(resource.snapshot, { id: 'stamina', value: 40, max: 40, ratio: 1 });
rejects(() => new ResourceBarModel({ id: 'bad', value: -1, max: 100 }), 'INVALID_NUMBER');
immutable(resource.snapshot);
cannotMutate(resource.snapshot, (state) => { state.value = 0; });

// Modal: payloads are copied, open/close are idempotent, and cyclic payloads are rejected.
const payload = { reward: { silver: 100 } };
const modal = new ModalModel({ id: 'reward' });
assert.equal(modal.open(payload), true);
payload.reward.silver = 0;
assert.deepEqual(modal.snapshot.payload, { reward: { silver: 100 } });
const modalOpenState = modal.snapshot;
assert.equal(modal.open({ ignored: true }), false);
assert.strictEqual(modal.snapshot, modalOpenState);
assert.equal(modal.close(), true);
assert.equal(modal.close(), false);
const cyclic = {};
cyclic.self = cyclic;
rejects(() => modal.open(cyclic), 'INVALID_SERIALIZABLE');
immutable(modal.snapshot);
immutable(modal.snapshot.payload);
cannotMutate(modal.snapshot, (state) => { state.isOpen = true; });

// List: stable sorting, empty state, page bounds, defensive copies, and hard upper limit.
const first = { id: 'a', data: { score: 2 } };
const second = { id: 'b', data: { score: 2 } };
const third = { id: 'c', data: { score: 1 } };
const list = new ListModel({
  items: [first, second, third],
  maxItems: 4,
  pageSize: 2,
  compare: (left, right) => right.data.score - left.data.score,
});
first.data.score = 99;
assert.deepEqual(list.snapshot.items.map((item) => item.id), ['a', 'b', 'c']);
assert.deepEqual(list.getPage(1).items.map((item) => item.id), ['a', 'b']);
assert.deepEqual(list.getPage(2).items.map((item) => item.id), ['c']);
const listBefore = list.snapshot;
rejects(() => list.getPage(0), 'LIST_PAGE_INVALID');
rejects(() => list.getPage(3), 'LIST_PAGE_INVALID');
rejects(() => list.replace([{ id: 'a', data: 1 }, { id: 'a', data: 2 }]), 'LIST_DUPLICATE_ID');
assert.strictEqual(list.snapshot, listBefore);
list.append({ id: 'd', data: { score: 0 } });
rejects(() => list.append({ id: 'e', data: 0 }), 'LIST_LIMIT');
assert.equal(list.snapshot.itemCount, 4);
cannotMutate(list.snapshot.items[0].data, (data) => { data.score = 0; });
list.clear();
assert.equal(list.snapshot.isEmpty, true);
assert.deepEqual(list.getPage(1), { page: 1, pageSize: 2, totalPages: 0, items: [], isEmpty: true });
rejects(() => new ListModel({ items: [{ id: 'x', data: undefined }] }), 'INVALID_SERIALIZABLE');
immutable(list.snapshot);
immutable(list.getPage(1));
cannotMutate(list.snapshot.items, (items) => { items.push({ id: 'bypass', data: 1 }); });

// Tabs: selection is explicit; disabled and unknown IDs do not mutate state.
const tabs = new TabsModel({
  tabs: [
    { id: 'all', label: '全部' },
    { id: 'owned', label: '已拥有' },
    { id: 'locked', label: '锁定', disabled: true },
  ],
});
assert.equal(tabs.snapshot.selectedId, 'all');
assert.equal(tabs.select('owned'), true);
const tabsBefore = tabs.snapshot;
assert.equal(tabs.select('owned'), false);
assert.equal(tabs.select('locked'), false);
assert.strictEqual(tabs.snapshot, tabsBefore);
rejects(() => tabs.select('missing'), 'TAB_NOT_FOUND');
rejects(() => new TabsModel({ tabs: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }] }), 'TAB_DUPLICATE_ID');
rejects(() => new TabsModel({ tabs: [{ id: 'locked', label: '锁定', disabled: true }] }), 'TABS_EMPTY');
immutable(tabs.snapshot);
immutable(tabs.snapshot.tabs);
cannotMutate(tabs.snapshot.tabs, (items) => { items.push({ id: 'bypass', label: '绕过' }); });

// Toast queue: queue order, injected-clock expiry, capacity, and immutable entries.
let now = 100;
const toasts = new ToastQueueModel({ now: () => now, maxQueue: 2, messageMaxLength: 8 });
const firstToastId = toasts.enqueue('第一条', 50);
const secondToastId = toasts.enqueue('第二条', 100);
assert.equal(firstToastId, 'toast-1');
assert.equal(secondToastId, 'toast-2');
assert.equal(toasts.enqueue('第三条', 100), null);
const toastBefore = toasts.snapshot;
now = 151;
assert.equal(toasts.snapshot.pendingCount, 1);
assert.equal(toasts.snapshot.entries[0].id, secondToastId);
assert.notStrictEqual(toasts.snapshot, toastBefore);
rejects(() => toasts.enqueue('超时', 0), 'INVALID_NUMBER');
rejects(() => toasts.enqueue('这条消息超过长度限制', 100), 'TEXT_TOO_LONG');
assert.deepEqual(toasts.consumeNext(), secondToastId ? { id: secondToastId, message: '第二条', createdAt: 100, expiresAt: 200 } : null);
assert.equal(toasts.consumeNext(), null);
rejects(() => toasts.dismiss(''), 'INVALID_ID');
immutable(toasts.snapshot);
cannotMutate(toasts.snapshot.entries, (entries) => { entries.pop(); });

// Toast operations clean expired entries before looking up IDs or counting entries.
let cleanupNow = 0;
const dismissQueue = new ToastQueueModel({ now: () => cleanupNow });
const expiredToastId = dismissQueue.enqueue('过期', 10);
const liveToastId = dismissQueue.enqueue('存活', 100);
cleanupNow = 10;
assert.equal(dismissQueue.dismiss(expiredToastId), false);
assert.equal(dismissQueue.snapshot.pendingCount, 1);
assert.equal(dismissQueue.snapshot.entries[0].id, liveToastId);

const clearQueue = new ToastQueueModel({ now: () => cleanupNow });
cleanupNow = 0;
clearQueue.enqueue('过期', 10);
clearQueue.enqueue('存活', 100);
cleanupNow = 10;
assert.equal(clearQueue.clear(), 1);
assert.equal(clearQueue.snapshot.pendingCount, 0);

// Additional hostile inputs are explicit regression cases, not fixture assertions.
const negativeCases = [
  () => new ButtonModel({ id: '', label: 'x' }),
  () => new ButtonModel({ id: 'x', label: 'x', maxLabelLength: 0 }),
  () => new ResourceBarModel({ id: 'x', value: 1, max: -1 }),
  () => new ResourceBarModel({ id: 'x', value: Number.POSITIVE_INFINITY, max: 1 }),
  () => new ModalModel({ id: '' }),
  () => new ListModel({ maxItems: 0 }),
  () => new ListModel({ maxItems: 1, items: [{ id: 'a', data: 1 }, { id: 'b', data: 2 }] }),
  () => new ListModel({ items: [{ id: 'x', data: { value: NaN } }] }),
  () => new ListModel({ pageSize: 0 }),
  () => new TabsModel({ tabs: [] }),
  () => new TabsModel({ tabs: [{ id: 'x', label: 'x', disabled: 'no' }] }),
  () => new ToastQueueModel({ maxQueue: 0 }),
  () => new ToastQueueModel({ now: () => Number.NaN }).snapshot,
  () => new ToastQueueModel({ now: () => 1 }).enqueue('x', -1),
  () => new ToastQueueModel({ now: () => 1 }).enqueue('x', Number.NaN),
  () => new LabelModel({ id: 'x', text: 1 }),
  () => new LabelModel({ id: 'x', text: null }),
  () => new ListModel({ items: null }),
  () => new ToastQueueModel({ maxQueue: null }),
  () => new ToastQueueModel({ now: () => Number.MAX_VALUE }).enqueue('x', Number.MAX_VALUE),
  () => new ToastQueueModel({ now: () => 1 }).expire(null),
  () => new ToastQueueModel({ now: () => 1 }).expire(undefined),
  () => new ToastQueueModel({ now: () => 1 }).consumeNext(null),
  () => new ToastQueueModel({ now: () => 1 }).consumeNext(undefined),
  () => {
    const array = [];
    array[Symbol('metadata')] = 'reject';
    return new ModalModel({ id: 'symbols' }).open(array);
  },
  () => {
    const array = [];
    array.metadata = 'reject';
    return new ModalModel({ id: 'extra-property' }).open(array);
  },
];
assert.equal(negativeCases.length, 26);
for (const negativeCase of negativeCases) assert.throws(negativeCase, (error) => error instanceof UiContractError);
assert.ok(negativeCases.length >= 14);

console.log(`UI component contract PASS (${negativeCases.length} negative cases)`);
