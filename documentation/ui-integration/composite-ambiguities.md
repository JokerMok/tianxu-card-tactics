# TypeID 15 组合效果中文候选说明

## 本轮范围

- 数据源为 `.local/ui-integration/census.json` 中 `TypeID = 15` 的 1,485 条 `EffectDes`。
- 本轮完成原始顺序前 800 条：逐条对照完整 `EffectDes` 复核名称、触发条件、对象、数值、概率、范围、持续回合、否定条件和能力术语，写入 `effect-composites-zh.json`，状态为 `candidate`。
- 后 685 条由另一覆盖任务负责，本文件保留其完整键位并标记为 `missing`，避免两个工作包同时改写同一范围。
- 候选来源保留在每条记录的 `source` 字段：已有 `effects-zh` 候选、Sol 手工翻译，或本地模型辅助草稿经 Sol 对照完整原文复核和修正。没有把模型草稿标成官方中文。

## 统一术语

- `CD / Countdown`：准备值；`ATK / Attack`：攻击力；`HP`：生命值；`Range`：射程；`Movement`：移动力；`Rank`：品质。
- `Nimble`：灵巧；`Shield Ward`：法术护盾；`Forestall`：预阻；`First Strike`：先攻；`Armor / Armour`：护甲；`Armor Break`：破甲；`Hit and Run`：游击。
- `Reanimate`：还魂；`Soulbound`：魂缚；`Arctic Barrier`：极寒屏障；`Predator`：捕食者；`Scary`：惊吓；`Distraction`：干扰。

## 源文本身仍有歧义或残缺

- `main:effect:2587` 的原文止于 `creatur`。候选按上下文译为“召唤时，对所有敌方生物造成 4 点闪电伤害”，但原始行缺失的尾部内容无法从 `EffectDes` 单独确认。
- `main:effect:1590` 只写“随机赋予目标敌方生物三种效果中的一种”，没有列出三种效果；候选不补写具体效果。
- `main:effect:216` 与 `main:effect:217` 分别写成死亡后转化为“基础品质 / 更高品质的随机敌方士兵”。“敌方”是否是源数据措辞错误无法确认，候选保留原意。
- `main:effect:225` 的英文原文本身是生硬的二次翻译句式；候选按四个可辨识机制保守翻译，没有推断未写出的区域或阵营条件。
- `main:effect:28558` 的 `creatures on both sides cannot summon each other` 对“互相召唤”的具体玩法对象定义不清，候选保持字面机制。
- `main:effect:327` 中两次 `your / enemy` 的指代不够明确；候选保留为“自身生命值 / 敌方生命值”，仍需要运行时或设计表确认指向的是生物还是英雄。

## 定向检查结果

- 键位与 census 中 1,485 个 TypeID 15 EffectID 一一对应；前 800 条为 `candidate`，后 685 条为 `missing`。
- 前 800 条均保留原始 `originalName`、`originalText` 和 `_row` 来源，中文名称与正文均非空。
- 已检查前 800 条的英文整段残留、常用能力术语、否定条件、数值、概率、范围和持续时间；发现的错对象、漏条件、错误数值、重复句和错配 EffectID 已回改。
- 这里的检查证明静态词典结构和候选文本范围；尚不代表官方译名确认，也不等于游戏内排版、截断或真实战斗机制验收。
