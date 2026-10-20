# 原版角色动画接入说明

## 当前实现

`scripts/import-kings-call.py` 从只读逆向研究目录生成本地、已忽略的 recovered 资源目录。角色链路为：

`main monster.xml MonsterID` → `animateitem` → `main items.xml 模型` → `status timeline` → `SWF display list` → `shape bitmap fill` → 已转换 PNG/JPEG。

主库怪物映射保存在 `catalog.scopes.main.monsterModels`。匹配只使用主客户端 `Resources_xml5/items.xml` 的模型，不从 media 或 actorItems 中按同名兜底。重复名称先比较状态 symbol 与模型名、再比较已链接状态数；无法唯一排名时保留源顺序，同时把 `resolution=exact_duplicate_source_order` 写入目录和报告。本次有 27 个怪物行落入该显式歧义状态，涉及重复引用，不能描述为全部唯一匹配。

导入器不会重新提取已经成功转换的位图，也不会把所有 SWF 烘焙为逐帧大图。它保留 shape 的 bounds、bitmap fill matrix 和 bitmap 依赖；本次复用 26,804 个现成位图，保留 29,308 个 shape/sprite 描述符。56,128 个被引用资源均来自固定 source manifest `5254333315581813739`，导入报告为 0 个导入错误。

玩家英雄走独立的原版 actor 链路。`ActorViewHelper.createDefaultAnimateObject` 证明 sex 0 为 female、1 为 male，职业 1—4 的默认 body id 分别为 100/200/300/400，weapon id 分别为 101/201/301/401。导入器再用 main actor.xml 把这些 component id 映射到 actorItems 模型，生成 `catalog.scopes.main.actorModels["profession:sex"]`。8 个职业/性别组合都得到精确的 body + weapon 双层模型。`setActor()` 同步播放两层各自的 stand/walk/atk timeline，并分别应用源 anchor 与 scale；没有把玩家英雄回退成通用怪物或卡面。

`RecoveredAnimation` 执行原时间线的 depth display list：支持 place/remove、Move 缺字段继承、子 timeline、父子矩阵组合、y 轴方向转换，以及用双旋转加缩放分解一般二维仿射矩阵。播放使用 status 的 `framerate` 和 `loop`，长帧停顿时每次 update 最多推进一帧。方向缺失时使用对向动画镜像。anchor 对齐到渲染原点，mount 暴露为 `mountNode`。`attack[0]` 作为攻击回调帧，0 按原逻辑回退第 3 帧。

技能特效的源链路不同于角色：`main Skill.xml` → effects 索引的 `visualModels` → `Resources_xml5.xml` 的 `magicitem/effect.animatename` → `Resources_xml13.xml` 的 emitter id → 精确 SWF 路径和导出 symbol → 已索引 timeline。导入器按数字 id、容器路径和 symbol 三项精确连接，不靠模型同名猜测，也不重新提取 SWF。粒子 emitter 的 `framerate` 覆盖 SWF 容器帧率；当前 730 个主库技能模型引用中，717 个已取得真实 timeline，覆盖 602 个技能。其余 13 个引用实际只涉及 `baofengxue_status`、`shihuashu_status` 两个没有 `animatename` 的状态模型，保持不可播放。

`RecoveredAnimation.setModels()` 可装入明确的源模型层；`playOneShot()` 优先选 stand，没有 stand 时选择第一个带真实 timeline 的源状态，强制单次播放，并在按 `show_frame_count / particle_framerate` 播完后只触发一次完成回调。它返回原始方向偏移，调用方将 Flash y 向下偏移转换到 Cocos y 向上坐标。`RecoveredEffects` 为每个 `visualModels` 条目建立独立节点和渲染器，放在以中心为原点、y 向上的战场设计坐标；各模型按自己的矩阵、偏移、帧率和帧数播放，完成后释放。单帧源效果仍可显示，但不被记录为动画证据。

Cocos Web 构建使用的宽松数组转换不能正确展开 Map/Set；原写法把 display Map 编译成单元素数组，造成 `state.matrix` 运行时报错。渲染器和特效管理器的 Map/Set 遍历全部显式使用 `Array.from`，同时忽略没有首次放置对象的孤立 move，并对继承矩阵保留 identity 兜底。

shape 在这批角色资源中全部有 bounds 和至少一个位图 fill。运行时选取有效位图 fill，并应用其 fill matrix；空的/纯色辅助 fill 不冒充角色图。当前角色 shape 是矩形位图帧，透明像素承担轮廓裁切。没有可加载 bitmap 的 timeline 会保持空白并报错，不会用卡面或单帧立绘伪装动画。

## 定向验证

运行：

```bash
node scripts/verify-recovered-visuals.mjs
```

验证器会选择三个来自不同 SWF 容器的 main 怪物，逐一检查 stand、walk、atk 时间线、实际位图文件、帧数、帧率、攻击事件帧和角色间源图哈希差异。本次样本均为 6 帧、8 fps、单段 0.75 秒，攻击事件在第 3 帧；三者首帧源图哈希互不相同。它还检查 8 个玩家职业/性别组合的 body、weapon 双层均有真实多帧 stand/walk/atk 和本地位图文件，8 个 body 首帧源图哈希互不相同。

技能部分选择三个真实多帧样本并检查来源容器、symbol、局部矩阵、位图依赖、源帧率和帧时长：`shouji` 为 7 帧/20 fps/0.35 秒，`xuanfengzhan` 为 10 帧/10 fps/1 秒，`huozhui` 为 10 帧/10 fps/1 秒。验证器用最小 Cocos 表面实际执行 `setModels → playOneShot → update`，确认各样本恰在源帧数后完成且回调只执行一次；同时要求 `.local/web/assets/main/index.js` 晚于渲染器源码、没有错误的 Map spread 构建结果，并包含 `Array.from` 显示列表遍历。真实浏览器画面和事件接线仍由集成验收执行。

## 已知边界

- 模型配置中 1,447 个模型有 atk/stand/walk；只有 120 个有 behit。当前导入模型没有独立 die timeline。`play('hit')` 会匹配 hit/behit/hurt，`play('die')` 会匹配 die/dead/death；源模型缺少对应状态时按原客户端规则回退 stand。这里是配置事实，不把 stand 回退写成死亡动画。
- 553 个 shape 含一个辅助纯色或空 bitmap fill 加一个有效位图 fill；渲染器使用有效位图 fill。角色帧之外的任意矢量路径、渐变、滤镜、脚本和非矩形 mask 尚未实现，不能据此声称所有 SWF 视觉元素都已还原。
- 主库 728 个技能中，116 个源记录没有 visualModels；另有 10 个技能只引用上述两个缺少 `animatename` 的状态模型。运行时对这些条目保持空白，不用卡面或单帧新图替代。
- TypeScript 已用本工程 Cocos 声明和 strict 模式做定向编译检查。验证器还检查最新 Web 构建产物；最终浏览器画面和战斗事件接线由集成线程验收，本文件不把静态或 mock 运行写成浏览器验收。
