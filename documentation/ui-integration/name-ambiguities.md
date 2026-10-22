# 卡名候选歧义记录

本表只记录会实质影响正式显示的名称歧义。`card-names.json` 中的 `candidate` 是工作译名，不表示从原客户端恢复出的官方中文；只有 `recovered` 与 `recovered-context` 带有现有字段或 `BGDes` 证据。

## 候选生成与复核来源

- 1852 个活动英文原名的初始工作译名由本机 Ollama `qwen3.5:4b` 分批生成，输入包含英文原名、`ResID` 和可用的 `BGDes`；没有调用外部 API。
- 本机 Ollama `qwen3.6:27b` 只对前 250 项做过一次辅助审阅并给出修改建议。该结果存在误改，未作为整批自动替换依据，只用于提示后续定向检查。
- `content-mapping.json` 中 41 条现有映射被优先复用；最终仅有可由 `card.Name` 或 `BGDes` 明确支持的 19 项标为 `recovered` / `recovered-context`，其余仍按 `candidate` 处理。
- Sol 复核范围是定向语义检查，并非逐项人工审校 1852 个名称：重点检查了中国神话与历史专名、Ogre / Lich 等类别词、短译名、超长译名、残留拉丁字母、模型解释性文本、Unicode 重复键，以及下表所列歧义项；对发现的问题做了人工覆盖。
- `missing=0`、键集合一致、无占位词、无纯英文同值等结果属于机械完整性检查，不能证明每个候选的语义都已人工确认。当前 1833 个 `candidate` 仍需正式本地化审校后才能作为定稿。

## 需后续原版资料确认

| 英文原名 | 当前候选 | 歧义 |
| --- | --- | --- |
| `20E Star Little Angel` / `20E Star Little Devil` | 20E星小天使 / 20E星小恶魔 | `20E` 的活动、版本或星级含义不明，原样保留前缀。 |
| `ARK Edge` | ARK 边缘 | `ARK` 作为系列标识保留；`Edge` 也可能指“刃”或职业名。 |
| `Abaddon` / `Abbadon` | 阿巴顿 / 亚巴顿 | 源数据同时存在两种拼写，可能是同一角色的拼写漂移，也可能是两个角色。 |
| `Ajiu` | 阿玖 | `ResID=goddess_orc` 只能确定角色类别，不能确定应写“阿九”“阿玖”或其他既有译名。 |
| `Aegis Lizard` | 圣盾蜥 | `Aegis` 可译为“圣盾”“神盾”或“庇护”，缺少原中文名称。 |
| `Angel Israphel` / `Black Angel Israel` | 大天使以斯拉斐尔 / 黑天使以斯拉 | `Israphel` 与 `Israel` 可能是专名拼写漂移，当前按英文分别音译。 |
| `Hachimana` | 八幡 | 可能指八幡神，也可能是虚构专名；当前采用最接近日语词源的短名。 |
| `Kozuki Sasuke` / `Kōzuki Sasuke` | 光月佐助 | 两个原名仅长音符不同，暂统一；姓氏也可能应按其他汉字写法。 |
| `Orin Kenbayou` | 奥林·肯巴尤 | 无中文上下文，采用音译；不能用资源名证明日文汉字写法。 |
| `Prince Yan` | 燕亲王 | `Yan` 可能对应燕、炎、严、颜或专名音译，`ResID=JP_Yang` 也与英文拼写不一致。 |
| `Wang Hun` | 王浑 | 可能是中文姓名，也可能是“亡魂”的转写或配置拼写，现有字段不足以唯一判断。 |
| `Xia Shen` | 夏神 | `ResID=zhongbubing01` 与名称不匹配，可能是复用资源，不能据此反推汉字。 |
| `Toyotama` | 丰玉 | 可能是“丰玉姬”的简称，也可能只是日文专名，当前使用短音译/常见汉字。 |
| `Tynas Dragoncrown` | 泰纳斯·龙冠 | `Dragoncrown` 可能是姓氏、称号或阵营名，当前按称号处理。 |
| `Yineput` | 伊奈普特 | 疑似埃及神名的变体拼写，当前按原拼写音译。 |
| `BB` 系列（如 `Marita BB`、`Nine BB`） | 保留 `BB` | 缩写含义没有可靠来源，不展开。 |

## 源数据规范化注意事项

以下英文键视觉上相同但 Unicode 不同，映射中按源字符串逐字保留，中文候选保持一致：

- `The Hostess` / `The Hostess`
- `Violet Duelist` / `Violet Duelist`
- `Zero BB` / `Zero BB`
- `Sylvia` / `Sylvia​`
- 其他带不间断空格、零宽字符、弯引号或尾随空格的名称

这种保留只服务于精确查表，不表示它们是不同角色。后续若清洗源数据，应先按卡牌 ID 与资源引用确认合并关系。
