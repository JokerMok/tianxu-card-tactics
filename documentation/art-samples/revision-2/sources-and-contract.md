# R2制作与接入规格

## 稳定映射

- `main:map:1` → v2清单`forest-map-1`；1600×800 JPG，原1200×600显示与四排坐标不变。连续地面覆盖脚底设计Y约124.5/219.5/314.5/409.5，操作栏仍由独立组件覆盖。
- `main:monster:1` → v2绘制图集；仍对应基础卫兵`main:card:1`，没有扩大到其他品质MonsterID。卡面原图只作身份参照，未修改。
- 品质框`quality-frame-0..6`、主/次/紧凑按钮四态、三种卡区图标、加减/锁止独立素材由`draw-ui-v2.py`绘制。面板继续复用v1无字金属材质，书本保留既有无字派生；动态中文字/数值仍由Cocos绘制。
- 当前清单：[manifest.json](../../../cocos-client/assets/resources/art-samples/v2/manifest.json)。清单内文件使用SHA256前12位后缀，避免新布局命中旧纹理缓存。v1不改；换皮肤不改DB。

## 单位播放器约定

透明图集1536×1536，单格256×256、6列；显示170×170，脚底`[128,220]`、挂点`[128,178]`；局部origin`[0,-32]`沿用已对齐原脚底的技术接入，名称固定`nameOffsetY=56`。包装时依据整张源表的列中心/地面基线，不逐帧按包围盒重居中；死亡也用相同缩放，未为倒地扩充人物体积。基础绘制源缩放0.60，独立更大步态源缩放0.31以匹配相同显示体高。

| 状态 | 起帧/数量 | 播放 | 事件及结束 |
|---|---|---|---|
| 警戒待机 | 0/6 | 8fps，循环 | 盾牌前置，轻呼吸 |
| 移动 | 6/8 | 13⅓fps，循环 | 真实抬腿/推地/落脚；位移仍由既有Speed/距离决定，不在素材中位移逻辑点 |
| 攻击 | 14/6 | 12fps，不循环 | 第3帧（从0起）0.25s交给原命中回调，随后回收；完成恢复待机 |
| 受伤 | 20/6 | 20fps，不循环 | 实际负HP变化触发；原generation保护避免旧受伤覆盖新攻击 |
| 死亡 | 26/6 | 7.5fps，不循环 | 失衡/屈膝/倒地全程后淡出，旧死亡实体生命周期继续保留 |
| 格挡反应 | 32/3 | 15fps，不循环 | 复用警戒/前盾支撑/警戒绘制姿势；仅权威blocked且无损HP触发，无攻击命中回调 |

左右围绕同一脚底镜像，挂点同步。名称/攻血仍挂在逻辑节点，不取每帧边界。未修改规则ID、伤害、AI、事件队列排序和服务器状态。

## 母图、派生及复现

- 母图：`art-source/revision-2/guard-painted-sheet.png`、`guard-walk-sheet.png`、`forest-map-1.png`，内置image_gen生成。原始输出保留于Codex generated_images；[来源记录](../../../art-source/revision-2/generation-record.json)含参照、生成文件名、制作意图及摘要。没有下载网络角色、购买或使用外部API密钥。
- `tools/art-samples/prepare-revision-2.py`：姿势切分、固定锚点、图集包装、地图导出、UI片段合并、内容摘要文件名。原始六帧保守步态留在母图，最终未使用。
- `tools/art-samples/draw-ui-v2.py`：原创几何/渐变/抗锯齿UI绘制，无字、透明内窗。不是旧素材调色，也不是整页截图烘焙。`ui-manifest.json`为制作片段，最终以运行manifest为准。

重制素材执行上述两个Python脚本；需要Pillow。前端源码有变化才重新构建，单纯清单/图像改动不需重编译Cocos。通常沿用`cocos-client/tools/build-p0.sh`；本轮最后新空项目发生导入器退化为`*`的环境问题，未修改正式场景或引擎绕过。最终构建位于`.local/art-revision/creator-warm/project/build/web-desktop`，它复制上轮已有效的导入缓存，覆盖25个当前入口依赖，再执行Creator原生构建。`stage-local.py`检查场景/脚本包非空及25文件匹配才复制到本地运行目录。

本机缓存构建的再编译命令（先同步当前入口依赖，不能直接拿旧包）：

```sh
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
 --project "$PWD/.local/art-revision/creator-warm/project" \
 --build "configPath=$PWD/.local/art-revision/creator-warm/build-config.json"
python3 tools/art-samples/stage-local.py --build-root .local/art-revision/creator-warm
```

缓存和录像不进入审阅包，不依赖生产数据。启动试玩只需已构建本地目录与现有运行资源，无需打开Creator。只确认这批样板的迭代流程，未批准其他兵种/地图批量制作。
