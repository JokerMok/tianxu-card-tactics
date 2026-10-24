# v2 UI 派生资产来源

- 制作方式：`tools/art-samples/draw-ui-v2.py` 使用 Pillow 几何图元、渐变和抗锯齿缩放程序绘制；未使用图像生成模型、外部图库或原 v1 像素拷贝。
- 视觉方向：深绿氧化金属、克制金边、透明卡图内窗；按钮全部无文字，动态中文仍由运行时代码单一渲染。
- 卡牌品质依据：真实恢复卡牌数据 当前实际 ServerContent.data.cards 中已启用、持有可读取的 Guard 变体有 Quality 0—6；183条旧预览样本仅有0—5，不足以作为全配置依据。本轮追加核对 main:card:23001 的真实 Quality 6，保留金色。七档同时使用不同边缘色和 1—7 个顶部菱形铆钉，不只依赖颜色。
- 安全区：卡框宽边仅占外缘，左上准备值、左下攻击和右下生命由运行时深色圆形底托承载；顶部品质铆钉避开左上数值区。
- 交互态：主要、次要、紧凑三类按钮各有 normal、selected/hover、pressed、disabled 四态；加、减、锁止图标与紧凑按钮共用同一材质体系。
- 原始边界：`cocos-client/assets/resources/art-samples/v1/` 保持只读；所有输出写入 `v2/`。`ui-manifest.json` 是供总 manifest 合并的 image 条目片段。
