# 资源替换契约

## 映射和边界

运行清单：`cocos-client/assets/resources/art-samples/v1/manifest.json`。`ArtSkin.ts` 只按作用域和稳定对象ID解析；游戏规则、卡牌ID、单位ID及存档字段不引用中文名或具体图像文件。`?skin=original` 返回旧资源路径；`?art=ui,background,unit` 可选择样板类别，不提供数据库回退。

| 稳定对象/组件角色 | 文件与尺寸 | 透明、锚点与依赖 |
|---|---|---|
| `main:map:1` | forest-map-1.jpg，1600×800 | 不含UI/单位/网格。仍显示在1200×600背景层，沿用90×95场景格和原交互坐标。 |
| 各族基础卡框、技能框、融合框角色 | card-frame.png，256×352 | RGBA透明内窗；显示85×116，动态准备值/攻血/名字保持A版承载；卡图仍来自原映射。 |
| A版侧栏/详情、共享基础面板 | panel.png，384×288 | 外缘透明、内底深青；九宫格左/右26、上/下24源像素；尺寸由现有组件决定。 |
| 主要文字按钮 | button-normal/selected/pressed/disabled.png，各256×56 | 无字、四个独立底板；九宫格左/右24、上/下12；动态文字单一来源。小型加减/纯图标保留原控件。四态在启动时预备，释放事件不被迟到图片覆盖。 |
| `main:monster:1` | guard-atlas.png，2048×1792 | 8列7行，54个256² RGBA帧。共享一份纹理/54个SpriteFrame；不按单位复制图集。 |

来源、母图SHA与生成ID见 `art-source/first-batch/provenance.json`；运行摘要见 `evidence/asset-hashes.json`。原始恢复资源未改写，运行白名单只增加9个显式文件，不含母图、模型、截图、录像、数据库或凭据。

## 卫兵坐标

图集单帧脚底基准是左上角像素坐标 `(128,220)`；显示包络170×170设计单位，Sprite锚点 `(0.5,0.140625)`。相对原战场逻辑点偏移 `(0,-32)`，用于对齐旧卫兵实际脚底，不改变单位节点、格子、攻血位置或部署热区。名称位置单独配置 `nameOffsetY:74`（相对逻辑点的设计坐标），不从图集透明留白推算头顶。方向围绕此脚底镜像；剑、盾、身体一起镜像，未单独反向武器。

挂点为源帧像素 `(122,173)`，换算到显示坐标再叠加上述偏移，约为逻辑点 `(-4,-1)`；向西时X反向。当前没有新增武器挂件特效，原公共挂点仍保持接口。不能把源像素挂点和逻辑偏移混用。

| 状态 | 起始帧（0起） | 数量/速率 | 循环与结束 |
|---|---:|---|---|
| stand | 0 | 8 / 12fps | 循环，轻微呼吸和重心变化 |
| walk | 8 | 12 / 16fps | 循环，骨骼摆腿/脚/持械手臂；位移仍由既有事件队列驱动 |
| atk | 20 | 12 / 20fps | 0.60秒结束；第5帧、0.25秒发一次命中回调，队列在该信号扣血 |
| hit | 32 | 6 / 20fps | 0.30秒结束；仅仍拥有该实体的播放代际可恢复待机 |
| die | 38 | 16 / 20fps | 0.80秒完成倒地，再淡出；保留既有死亡实体两秒生命周期后释放 |

动作取消会解除等待，不补发命中或结束回调；无固定150ms通用节拍。既有权威事件队列负责移动/攻击/命中/死亡的优先次序。原没有死亡原生动作的单位仍用旧AlphaEffect兼容路径。

## 可复现制作与构建

```bash
blender -b -t 2 --python tools/art-samples/build-guard.py -- --stage atlas --output .local/art-samples/model
python3 tools/art-samples/prepare-assets.py
P0_BUILD_ROOT="$PWD/.local/art-samples/creator-build-rebuild" P0_RECORD_BUILD_LOCATION=0 bash cocos-client/tools/build-p0.sh
python3 tools/art-samples/stage-local.py --build-root .local/art-samples/creator-build-rebuild
tools/art-samples/start-local.command
```

母图没有运行时自动生成步骤；图像生成能力在本轮实际使用，提示要点、加工与模型可编辑源均留存。`blockout/detail`检查图属于离线模型检查，不是游戏截图。渲染、编码、Cocos构建按本机重任务槽串行执行。

## 缓存与释放

UI固定缓存上限8项，本包实际6项；不会随单位/切页增长，游戏组件销毁后释放。单位图集池上限4个资源条目，本批仅1个；只在使用期间保留引用，最后实体释放时销毁54个帧对象、纹理与图像。当前图集RGBA基础层约14MiB（不含驱动额外开销/可能mipmap），不能把960KiB压缩PNG当作显存。未来应按新包版本添加资源，避免覆盖浏览器已缓存的同名版本文件。
