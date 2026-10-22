const namesByContent = new WeakMap();

const BUILDINGS = Object.freeze({
  castle: '城堡',
  dock: '码头',
  alchemy: '炼金房',
  smithy: '铁匠铺',
  defense: '城防',
});

const ITEM_ID_FIELDS = ['物品ID\n', '物品ID', 'ID'];
const ITEM_NAME_FIELDS = ['名字\n', '名字', '名称\n', '名称', 'Name', 'name'];
const ASSET_OBJECT_PREFIX = '出售|使用|存入|取出|锁定(?:仓库)?|解锁(?:仓库)?|强化|精炼|分解|合成|融合|点化|炼制(?:卡牌)?|制造(?:装备)?|购买|兑换|选择|附件|物品|卡牌|装备';

function first(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sourceName(row, fields) {
  const value = first(row, fields);
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function presentationNames(content) {
  if ((!content || (typeof content !== 'object' && typeof content !== 'function')) || typeof content.table !== 'function') {
    throw new TypeError('content.table is required');
  }
  const cached = namesByContent.get(content);
  if (cached) return cached;

  const names = {};
  for (const tableName of ['medicament', 'warrant', 'equipment']) {
    for (const row of content.table(tableName) ?? []) {
      const id = positiveId(first(row, ITEM_ID_FIELDS));
      const name = sourceName(row, ITEM_NAME_FIELDS);
      const key = id && `main:item:${id}`;
      if (key && name && !Object.hasOwn(names, key)) names[key] = name;
    }
  }
  for (const row of content.table('card') ?? []) {
    const id = positiveId(first(row, ['ID', '卡牌ID\n', '卡牌ID']));
    const name = sourceName(row, ['Name', '名字\n', '名字', '名称\n', '名称']);
    if (id && name) names[`main:card:${id}`] = content.catalog?.localization?.cards?.[`main:card:${id}`]?.name ?? name;
  }

  const result = Object.freeze(names);
  namesByContent.set(content, result);
  return result;
}

function displayName(names, kind, id) {
  const key = `main:${kind}:${id}`;
  return names[key] || (kind === 'item' ? `物品 #${id}` : `卡牌 #${id}`);
}

function presentText(value, names) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/main:(item|card):(\d+)/g, (_, kind, id) => displayName(names, kind, id))
    .replace(/\b(castle|dock|alchemy|smithy|defense)\b/g, key => BUILDINGS[key]);
}

function payloadAsset(payload, key, kind) {
  const raw = payload?.[key];
  const match = typeof raw === 'string' ? raw.match(new RegExp(`^main:${kind}:(\\d+)$`)) : null;
  const id = positiveId(match ? match[1] : raw);
  return id ? { kind, id } : null;
}

function replaceObjectId(label, asset, names, allowLeading = false) {
  if (typeof label !== 'string' || !asset) return label;
  const name = displayName(names, asset.kind, asset.id);
  if (label.includes(name)) return label;
  const escaped = String(asset.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const contextual = new RegExp(`((?:${ASSET_OBJECT_PREFIX})\\s*[:：#]?)${escaped}(?!\\d)`);
  const leading = new RegExp(`^${escaped}(?=\\s*(?:[·:：-]|$))`);
  if (allowLeading && leading.test(label)) return label.replace(leading, name);
  if (label.trim() === String(asset.id)) return name;
  return label.replace(contextual, (_, prefix) => `${prefix}${name}`);
}

function localizeCardLiteral(text,asset,names,content){
  if(typeof text!=='string'||asset?.kind!=='card')return text;
  const original=content?.data?.cards?.[String(asset.id)]?.raw?.Name;
  return typeof original==='string'&&original.length>0?text.split(original).join(displayName(names,'card',asset.id)):text;
}
function presentOption(option, names, content) {
  if (!option || typeof option !== 'object') return option;
  const asset = payloadAsset(option, 'itemId', 'item')
    || payloadAsset(option, 'cardId', 'card')
    || payloadAsset({ cardId: option.value }, 'cardId', 'card')
    || payloadAsset({ itemId: option.value }, 'itemId', 'item');
  const label = localizeCardLiteral(replaceObjectId(presentText(option.label, names), asset, names, true),asset,names,content);
  return label === option.label ? option : { ...option, label };
}

function presentField(field, names, content) {
  if (!field || typeof field !== 'object' || !Array.isArray(field.options)) return field;
  const options = field.options.map(option => presentOption(option, names, content));
  return options.every((option, index) => option === field.options[index]) ? field : { ...field, options };
}

export function presentSections(content, sections) {
  if (!Array.isArray(sections)) throw new TypeError('sections must be an array');
  const names = presentationNames(content);
  return sections.map(section => ({
    ...section,
    items: Array.isArray(section?.items) ? section.items.map(item => {
      const itemAsset = payloadAsset(item?.payload, 'itemId', 'item');
      const cardAsset = payloadAsset(item?.payload, 'cardId', 'card');
      let label = presentText(item?.label, names);
      label = localizeCardLiteral(replaceObjectId(label, itemAsset || cardAsset, names),cardAsset,names,content);
      const detail = localizeCardLiteral(presentText(item?.detail, names),cardAsset,names,content);
      const fields = Array.isArray(item?.fields) ? item.fields.map(field => presentField(field, names, content)) : item?.fields;
      return { ...item, label, detail, ...(fields === undefined ? {} : { fields }) };
    }) : section?.items,
  }));
}
