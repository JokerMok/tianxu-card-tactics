# 天墟：万象战阵

东方幻想题材的双战线战术卡牌游戏。通过卡牌准备、单位部署、战线推进和技能干预组织战斗，客户端基于 Cocos Creator 3.8.8 与 TypeScript 开发。

仓库：<https://github.com/JokerMok/tianxu-card-tactics>。原本地工作目录名为“横屏战术卡牌原型”，现统一项目名称为“天墟：万象战阵”；既有工程路径与历史文档保留。

## 当前进度

当前可评审内容包括九个系统页面、首关 1-1 的真实战斗、结算奖励和本地存档。战场采用两条战线，每条 12 个隐藏逻辑格；选中可部署卡牌时显示合法落点。系统页与战斗 HUD 使用深玉旧金材质，地图内展示双方主将和兵种。

2026-09-30 的首关版本已完成同材质双行石台、主将位置与人物比例调整，并保存双行实际部署的验证结果。U002 已接入八张侧向姿势与攻击命中事件；其他兵种、主将动作和可编辑骨骼仍在制作。场景目前使用合成评审底图，正式分层资产、目标平台性能和商业上线验收尚未完成。详细状态见 [.codex/PROJECT_STATE.md](.codex/PROJECT_STATE.md)。

## 目录

| 目录 | 内容 |
| --- | --- |
| `cocos-client/` | 当前客户端、战斗逻辑、运行所需美术、配置与工具 |
| `web-prototype/` | 早期 React 规则验证原型及相关测试依赖 |
| `backend/` | 现有服务端相关代码，能力范围以目录内实现为准 |
| `documentation/`、`文档/` | 开发文档、配置说明与阶段资料 |
| `美术素材/` | 已纳入版本管理的素材、清单与规范 |
| `.ai-dev/` | 开发任务、计划与阶段证据 |

本地 `交付/` 中的重复构建包、`美术素材/生成/` 中的生图草稿、依赖缓存和 Creator 自动生成目录由 Git 忽略。运行所需的新资源保存在 `cocos-client/assets/`，随源码提交。

## 开发

安装 Cocos Creator **3.8.8**，在 Creator 中打开 `cocos-client/` 并预览 `assets/scenes/BattleA0.scene`。客户端内部工程标识保留为 `tianxu-cocos-a0`，供现有构建和评审工具使用。

部分客户端检查脚本复用 `web-prototype/` 下的 TypeScript 和 Playwright 依赖，可在仓库根目录安装：

```bash
npm --prefix web-prototype ci
```

需要使用浏览器验证脚本时，再安装 Playwright 的 Chromium：

```bash
cd web-prototype
npx playwright install chromium
```

当前首关的隔离构建入口：

```bash
cd cocos-client
P0_RECORD_BUILD_LOCATION=0 bash tools/build-p0.sh
```

脚本默认使用 `/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator`，可通过 `COCOS_CREATOR_BIN` 指定本机安装路径。成功后会打印 Web Desktop 输出目录，用本地 HTTP 服务打开该目录即可体验。URL 加上 `?battleReview=two-lanes` 可启用双行部署评审的固定抽牌顺序。

## 验证记录

最近一次玩法与画面验证日期为 **2026-09-30**：覆盖 TypeScript 入口、上下双行真实投放、资源加载、主将与兵种朝向/比例、战斗 UI 交互及 U002 攻击命中同步。2026-10-20 的仓库初始化仅核对命名、提交范围与上传结果，未重新执行整套游戏回归。

历史设计、考证和验收材料记录的是各阶段结论；当前能力应结合源码与项目状态判断。
