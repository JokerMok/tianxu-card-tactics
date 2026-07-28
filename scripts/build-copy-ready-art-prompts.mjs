import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(root, "全量美术生图提示词-可直接复制版-v1.7.md");

const files = {
  rules: fs.readFileSync(path.join(root, "全量美术生图提示词总则-v1.2.md"), "utf8"),
  roles: fs.readFileSync(path.join(root, "角色与兵种生图提示词库-v1.2.md"), "utf8"),
  cards: fs.readFileSync(path.join(root, "卡牌套装与技能生图提示词库-v1.0.md"), "utf8"),
  scene: fs.readFileSync(path.join(root, "场景战场UI特效生图提示词库-v1.2.md"), "utf8"),
  special: fs.readFileSync(path.join(root, "成年角色特殊版生图提示词库-v1.0.md"), "utf8"),
};

function parseLevel3Blocks(markdown) {
  const blocks = new Map();
  const pattern = /^###\s+(.+?)\n\n```text\n([\s\S]*?)\n```/gm;
  for (const match of markdown.matchAll(pattern)) {
    const title = match[1].trim();
    const id = title.split(/\s+/)[0];
    blocks.set(id, { id, title, body: match[2].trim() });
  }
  return blocks;
}

function extractCodeAfter(markdown, headingPattern) {
  const pattern = new RegExp(`${headingPattern}[\\s\\S]*?\\x60\\x60\\x60text\\n([\\s\\S]*?)\\n\\x60\\x60\\x60`, "m");
  const match = markdown.match(pattern);
  if (!match) throw new Error(`Cannot find code block after ${headingPattern}`);
  return match[1].trim();
}

function requireBlock(blocks, id) {
  const block = blocks.get(id);
  if (!block) throw new Error(`Missing source block: ${id}`);
  return block;
}

function joinPrompt(...parts) {
  return parts
    .filter(Boolean)
    .map((part) => part.trim())
    .join("\n\n");
}

function characterIdentitySummary(characterBody) {
  const firstSentence = characterBody.split("。")[0]?.trim();
  if (!firstSentence) throw new Error("Character identity summary is empty");
  return `${firstSentence}。服装、武器、纹章、族属器官、材质和主色严格以Image 1为准，不沿用卡面动作与背景。`;
}

function inlineUiReference(prompt) {
  return prompt
    .replace(/^使用UI-STYLE并引用MAP-C01地图。/, "")
    .replace(/^使用UI-STYLE。/, "")
    .trim();
}

function parsePromptTable(markdown, idPrefix) {
  const entries = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith(`| ${idPrefix}`)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    entries.push({ id: cells[0], name: cells[1], body: cells.slice(2).join(" | ") });
  }
  return entries;
}

function parseRarityTable(markdown) {
  const entries = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s+(R[0-3]\s+[^|]+)\s+\|\s+`(.+)`\s+\|$/);
    if (!match) continue;
    const [id, ...nameParts] = match[1].trim().split(/\s+/);
    entries.push({ id, name: nameParts.join(" "), body: match[2].trim() });
  }
  return entries;
}

const ruleBlocks = parseLevel3Blocks(files.rules);
const roleBlocks = parseLevel3Blocks(files.roles);
const cardBlocks = parseLevel3Blocks(files.cards);
const sceneBlocks = parseLevel3Blocks(files.scene);
const specialBlocks = parseLevel3Blocks(files.special);

const universalNegative = extractCodeAfter(files.rules, "^## 5\\. 通用排除块");
const identityLock = extractCodeAfter(files.rules, "^## 6\\. 一致性提示词");
const commercialSafe = extractCodeAfter(files.scene, "商业素材统一追加：");
const vfxPrefix = extractCodeAfter(files.scene, "特效通用前缀：");

const styleAdult = requireBlock(ruleBlocks, "P-STYLE-ADULT").body;
const styleUnit = requireBlock(ruleBlocks, "P-STYLE-UNIT").body;
const styleSkill = requireBlock(ruleBlocks, "P-STYLE-SKILL").body;
const canvasCard = requireBlock(ruleBlocks, "P-CANVAS-CARD").body;
const canvasSheet = requireBlock(ruleBlocks, "P-CANVAS-SHEET").body;
const canvasPortrait = requireBlock(ruleBlocks, "P-CANVAS-PORTRAIT").body;
const canvasEnvironment = requireBlock(ruleBlocks, "P-CANVAS-ENVIRONMENT").body;
const canvasModelSheet = requireBlock(ruleBlocks, "P-CANVAS-MODEL-SHEET").body;
const canvasAnimationPose = requireBlock(ruleBlocks, "P-CANVAS-ANIMATION-POSE").body;
const envStyle = requireBlock(sceneBlocks, "ENV-STYLE").body;
const envNegative = requireBlock(sceneBlocks, "ENV-NEGATIVE").body;
const uiStyle = requireBlock(sceneBlocks, "UI-STYLE").body;

const characterIds = Array.from({ length: 10 }, (_, index) => `C${String(index + 1).padStart(3, "0")}`);
const unitIds = Array.from({ length: 28 }, (_, index) => `U${String(index + 1).padStart(3, "0")}`);
const skillIds = Array.from({ length: 16 }, (_, index) => `S${String(index + 1).padStart(3, "0")}`);
const environmentIds = Array.from({ length: 12 }, (_, index) => `E${101 + index}`);

const sections = [];
let promptCount = 0;

function addSection(title, intro = "") {
  sections.push(`## ${title}\n${intro ? `\n${intro.trim()}\n` : ""}`);
}

function addPrompt(id, title, prompt, note = "") {
  if (!prompt || prompt.includes("undefined")) throw new Error(`Invalid prompt: ${id}`);
  promptCount += 1;
  sections.push(`### ${id} ${title}${note ? `\n\n${note.trim()}` : ""}\n\n\u0060\u0060\u0060text\n${prompt.trim()}\n\u0060\u0060\u0060\n`);
}

addSection("1. 使用说明", "每个代码块都是完整提示词，不需要再查母版或手动拼接。标注“需附参考图”的条目必须同时上传已经通过评审的角色或单位设定图，并把它作为 Image 1。纯立绘、卡框、背景和正式UI不生成文字；整卡评审样机除外。");

addSection("2. 十名核心角色卡面");
for (const id of characterIds) {
  const character = requireBlock(roleBlocks, id);
  addPrompt(`${id}-CARD`, character.title.replace(`${id} `, ""), joinPrompt(canvasCard, styleAdult, character.body, universalNegative));
}

addSection("3. 十名核心角色设定、头像与制作资产", "本节全部以对应角色已通过的卡面或设定图为 Image 1。提示词已经写入身份锁定要求。");
const characterDerivativeSpecs = [
  ["SHEET", "正侧背设定板", canvasSheet, "本图为角色设定板，以统一站姿、正侧背视图和拆解要求替代主体描述中的卡面动作与背景。"],
  ["PORTRAIT", "三表情头像组", canvasPortrait, "本图为头像组，以固定胸像镜头和三种表情替代主体描述中的全身动作与背景。"],
  ["SILHOUETTE", "六方案轮廓板", requireBlock(roleBlocks, "CHARACTER-SILHOUETTE").body, "本图只评审轮廓，以六格剪影要求替代主体描述中的材质、表情、动作与背景。"],
  ["FACE", "三方案面部板", requireBlock(roleBlocks, "CHARACTER-FACE").body, "本图只评审面部，以统一面部镜头替代主体描述中的全身动作与背景。"],
  ["COSTUME", "服装拆层板", requireBlock(roleBlocks, "CHARACTER-COSTUME-LAYERS").body, "本图只评审服装结构，以无头人台与拆层要求替代主体描述中的人物姿态和场景。"],
  ["COS-BUILD", "Cos制作参考板", requireBlock(roleBlocks, "CHARACTER-COS-BUILD").body, "本图只评审实物制作，以样衣、支撑与连接要求替代卡面动作和场景。"],
  ["COS-PHOTO", "Cos成片预览", requireBlock(roleBlocks, "CHARACTER-COS-PHOTO").body, "本图为低尺度商业成片，以成年模特和摄影要求替代卡面动作与背景。"],
];
for (const id of characterIds) {
  const character = requireBlock(roleBlocks, id);
  const name = character.title.replace(`${id} `, "");
  const identitySummary = characterIdentitySummary(character.body);
  for (const [suffix, label, spec, override] of characterDerivativeSpecs) {
    addPrompt(
      `${id}-${suffix}`,
      `${name}·${label}`,
      joinPrompt(identityLock, identitySummary, spec, override, universalNegative),
      "需附参考图：Image 1。",
    );
  }
}

addSection("4. 十名核心角色2D骨骼拆分参考", "本节只用于分层切片、关节遮挡和横版轮廓评审。正式战场资产必须制作分层源文件、骨骼或序列帧工程、纹理图集、动画数据和挂点配置。");
const characterModelSheet = requireBlock(roleBlocks, "CHARACTER-MODEL-SHEET").body;
for (const id of characterIds) {
  const character = requireBlock(roleBlocks, id);
  addPrompt(
    `${id}-MODEL-SHEET`,
    `${character.title.replace(`${id} `, "")}·2D骨骼拆分参考`,
    joinPrompt(canvasModelSheet, identityLock, characterIdentitySummary(character.body), characterModelSheet, universalNegative),
    "需附参考图：Image 1。",
  );
}

addSection("5. 十名固定主将动画姿势板", "本节用于固定主将分层骨骼的身份锁定、轻重受击、施令、濒危和败退姿势评审。每次附上对应角色已通过的卡面或设定图作为Image 1；主将不制作移动循环。正式资产由分层源文件和2D骨骼工程实现。");
const commanderAnimation = requireBlock(roleBlocks, "COMMANDER-BATTLE-ANIMATION").body;
for (const id of characterIds) {
  const character = requireBlock(roleBlocks, id);
  addPrompt(
    `${id}-COMMANDER-ANIMATION`,
    `${character.title.replace(`${id} `, "")}·固定主将动画姿势板`,
    joinPrompt(canvasAnimationPose, identityLock, characterIdentitySummary(character.body), commanderAnimation, universalNegative),
    "需附参考图：Image 1。",
  );
}

addSection("6. 二十八张单位卡面");
for (const id of unitIds) {
  const unit = requireBlock(roleBlocks, id);
  addPrompt(`${id}-CARD`, unit.title.replace(`${id} `, ""), joinPrompt(canvasCard, styleUnit, unit.body, universalNegative));
}

addSection("7. 二十八个兵种2D骨骼拆分参考", "本节输出切片与关节遮挡参考板，不直接输出正式战场资产。");
const unitModelSheet = requireBlock(sceneBlocks, "UNIT-MODEL-SHEET").body;
for (const id of unitIds) {
  const unit = requireBlock(roleBlocks, id);
  addPrompt(`${id}-MODEL-SHEET`, `${unit.title.replace(`${id} `, "")}·2D骨骼拆分参考`, joinPrompt(canvasModelSheet, styleUnit, unit.body, unitModelSheet, "本图以切片参考板的中性姿态、部件拆分和固定横版预览为最高优先级，替代单位卡面主体描述中的攻击动作、目标、特效和场景。", universalNegative));
}

addSection("8. 动画关键姿势与横版预览", "本节适用于全部具名角色和兵种。每次附上对应切片参考板作为Image 1；输出仅供2D骨骼或序列帧动画制作和战场可读性评审。");
for (const id of ["BATTLE-IDLE", "BATTLE-MOVE", "BATTLE-ATTACK", "BATTLE-HIT", "BATTLE-DEATH", "BATTLE-CAST", "BATTLE-SUPPORT", "BATTLE-CAMERA-PREVIEW"]) {
  const action = requireBlock(sceneBlocks, id);
  const canvas = id === "BATTLE-CAMERA-PREVIEW" ? "" : canvasAnimationPose;
  addPrompt(id, action.title.replace(`${id} `, ""), joinPrompt(canvas, identityLock, action.body, universalNegative), "需附参考图：Image 1。正式资产由分层源文件、2D骨骼或人工校正序列帧实现。" );
}

addSection("9. 十六张技能卡");
for (const id of skillIds) {
  const skill = requireBlock(cardBlocks, id);
  addPrompt(id, skill.title.replace(`${id} `, ""), joinPrompt(styleSkill, skill.body, universalNegative));
}

addSection("10. 卡框、卡背、卡牌套与卡包");
for (const id of [
  "CARD-FRAME-BOARD",
  "CARD-FRAME-UNIT",
  "CARD-FRAME-SKILL",
  "CARD-FRAME-CHARACTER",
  "CARD-BACK-BASE",
  "DECK-HUMAN",
  "DECK-WING",
  "DECK-SCALE",
  "DECK-MOUNTAIN",
  "DECK-REVENANT",
  "DECK-CRAFT",
  "DECK-BEAST",
  "DECK-COMMAND",
  "DECK-ARCANE",
  "DECK-COVENANT",
  "DECK-SHADOW",
  "PACK-BASE",
  "PACK-OPEN",
]) {
  const block = requireBlock(cardBlocks, id);
  addPrompt(id, block.title.replace(`${id} `, ""), joinPrompt(block.body, universalNegative));
}
for (const rarity of parseRarityTable(files.cards)) {
  addPrompt(`CARD-RARITY-${rarity.id}`, `稀有度覆盖层·${rarity.name}`, joinPrompt(rarity.body, universalNegative));
}
const r1Cover = requireBlock(cardBlocks, "8.2");
addPrompt("DECK-R1-COVER", "R1三十张混编套牌封面", joinPrompt(r1Cover.body, universalNegative));
const cardReviewMockup = extractCodeAfter(files.cards, "^## 10\\. 整卡评审样机");
addPrompt("CARD-REVIEW-MOCKUP", "整卡文字评审样机", cardReviewMockup, "只用于评审文字与布局，不得作为正式卡牌资产。" );

addSection("11. 第一章十二个战场");
for (const id of environmentIds) {
  const environment = requireBlock(sceneBlocks, id);
  addPrompt(id, environment.title.replace(`${id} `, ""), joinPrompt(canvasEnvironment, envStyle, environment.body, envNegative));
}

addSection("12. 章节地图与无籍行营");
for (const id of ["MAP-C01", "HUB-01"]) {
  const block = requireBlock(sceneBlocks, id);
  addPrompt(id, block.title.replace(`${id} `, ""), joinPrompt(envStyle, block.body, envNegative));
}

addSection("13. 攻型、五行与状态特效");
for (const entry of [...parsePromptTable(files.scene, "VFX-A"), ...parsePromptTable(files.scene, "VFX-E"), ...parsePromptTable(files.scene, "VFX-S")]) {
  addPrompt(entry.id, entry.name, joinPrompt(vfxPrefix, entry.body));
}

addSection("14. UI界面与组件");
for (const id of ["UI-01", "UI-02", "UI-03", "UI-04", "UI-05", "UI-06", "UI-07"]) {
  const block = requireBlock(sceneBlocks, id);
  addPrompt(id, block.title.replace(`${id} `, ""), joinPrompt(uiStyle, inlineUiReference(block.body)));
}
for (const id of ["UI-TEXTURE-BOARD", "UI-FRAME-KIT", "ICON-SYSTEM", "ICON-COMBAT-TYPES"]) {
  const block = requireBlock(sceneBlocks, id);
  addPrompt(id, block.title.replace(`${id} `, "") || id, joinPrompt(uiStyle, block.body));
}

addSection("15. 商业发行素材", "本节已经合并低尺度商店审核要求，不直接使用游戏内高尺度姿态。");
for (const id of ["MKT-01", "MKT-02", "MKT-03", "MKT-04", "MKT-05", "MKT-06", "MKT-07"]) {
  const block = requireBlock(sceneBlocks, id);
  addPrompt(id, block.title.replace(`${id} `, ""), joinPrompt(commercialSafe, block.body, universalNegative));
}

addSection("16. 成年角色特殊版", "本节仅适用于C001-C010十名二十一岁以上角色。SPECIAL-01是完整基础提示词；SPECIAL-02是半透明遮蔽结构编辑提示词，必须将对应SPECIAL-01成图作为Image 1。半透明材质不得显示乳头、乳晕、下体、私密轮廓或臀沟；本节不得用于十八至二十岁角色、未成年角色、商店图或广告素材。");
for (const id of characterIds) {
  for (const version of ["01", "02"]) {
    const specialId = `${id}-SPECIAL-${version}`;
    const block = requireBlock(specialBlocks, specialId);
    addPrompt(specialId, block.title.replace(`${specialId} `, ""), block.body, version === "02" ? "需附参考图：对应SPECIAL-01成图作为Image 1。" : "");
  }
}

const header = `# 全量美术生图提示词·可直接复制版

版本：v1.7  
日期：2026-07-15  
状态：生效  
生成方式：由 \u0060scripts/build-copy-ready-art-prompts.mjs\u0060 根据Cocos Creator 2D路线下的五册生效提示词文档自动编译  

本文件只保留可直接提交给生图模型的完整提示词。战场单位相关提示词只生产2D切片、骨骼动画和横版战场预览参考，不直接生成正式运行资产。源规则调整后重新运行构建脚本，禁止手工修改本文件造成两套规格分叉。

`;

const output = `${header}${sections.join("\n")}\n`;
if ((output.match(/```text/g) ?? []).length !== promptCount) {
  throw new Error("Prompt block count does not match generated prompt count");
}
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(`${path.basename(outputPath)}\nPROMPTS=${promptCount}\nBYTES=${Buffer.byteLength(output)}\n`);
