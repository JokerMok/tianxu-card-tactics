# TypeID=15 尾段中文候选歧义清单

- 范围：`census.json` 中 `TypeID == 15` 的原始列表索引 800 至末尾，共 685 条；首条为 `EffectID 28470`，末条为 `EffectID 50`。
- 机制来源：逐条直接翻译 `EffectDes`，保留 `originalName` 与 `originalText`；未用 `TypeDes` 或子效果拼接替代完整原句。
- 结果：685 条均为完整中文 `candidate`，`missing` 为 0；没有英文名称占位、按 ID 占位名或正文英文残留。
- 术语：`CD/Countdown` 统一为“准备值”，`ATK/Attack` 为“攻击力”，`HP/Life/Health` 为“生命值”，`Range` 为“射程”，`Movement` 为“移动力”，`Rank` 为“品质”。

## 需要人工定稿的源文歧义

- `EffectID 1565`：源数据 `Name` 为空；依据完整描述“飞行、护甲、穿过非飞行生物、物理减伤 3”暂拟名称“飞行护甲”。
- `EffectID 222`：`same amount of blood` 是明显的英文源文错误；依上下文暂译为“造成伤害时恢复等量生命值”，恢复对象按施法者理解。
- `EffectID 220`：原文只有叙事句“随机召唤烈焰军团”，没有数量、具体单位、位置或频率；中文不补写这些机制。
- `EffectID 28516`：`Movement +N` 中 `N` 没有定义；中文保留为“拥有‘移动力+N’效果”，不推定N的具体数值。
- `EffectID 28417`：原文只写 `heal self`，没有治疗量；中文保留“为自身恢复生命值”，不补写数值。
- `EffectID 28538`：电击陷阱与电磁牢笼的进入、停留、持续关系按原句直译；原文没有说明陷阱是否在触发后消失。
- `EffectID 2215`：`40% chance enemy hero fails to draw. If drawn` 没有明确一次抽牌还是每次抽牌；中文保持“抽牌失败；若抽牌成功”的条件关系，不补写触发频率。
- `EffectID 28220`：原句同时出现 `Upon acting` 和 `each turn`；中文同时保留“行动时”和“每回合”，未擅自删除任一触发词。
- `EffectID 2859`：`takes x2 damage for 3 turns` 未说明加倍仅来自施法者还是所有来源；中文保留“受到双倍伤害，持续 3 回合”。
- `EffectID 28539`：原文说明先反射一半再承受剩余一半，但没有定义奇数伤害的取整规则；中文不补写取整方式。
- `EffectID 28626`：原文变量 `N` 等于 1 格内友方生物攻击力总和；中文原样保留变量与 `N > 0` 条件。
- `EffectID 28533`：`Lovesickness` 与牛郎、鹊桥语境对应，暂译“相思”；这是候选专名，不视为官方译名。
- `EffectID 28229`：原名称 `win Serpents' Domain` 疑似缺字或截断；暂按描述语境拟为“双蛇领域”。
- `EffectID 28327`：原名称 `First EX` 含义不完整；暂按首回合增益机制拟为“首回合爆发”。
- `EffectID 28619`：`Mirrorcrafted` 未在该句解释具体系统规则；暂译“镜像制造”，不扩写其判定方式。
- `EffectID 50`：`finish its own turn before dying` 的主语时序依原句译为“完成自己的当前回合后再死亡”，未推断额外行动次数。

以上条目只标记专名或英文源句本身的信息缺口。中文候选没有增加原文未给出的概率、数值、次数、范围或持续时间。
