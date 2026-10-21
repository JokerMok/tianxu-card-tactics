# 恢复动画时序修正

核对范围：`RecoveredAnimation` 的 SWF display-list 时间线与动作完成生命周期。依据为只读源中的 `MovieClipRenderer.as`、`SwfAnimateSceneObject.as`、`AnimateItemInfo.as`、`client-handoff/data/animation-rules.json`，以及当前导入 catalog 的实际 timeline 记录。

## 时间映射

- 根动作仍按模型 `status.framerate` 推进；未配置时沿用 timeline fps。一次渲染更新至多推进一帧，不在卡顿后批量追帧。
- 子 timeline 从它在父 timeline 的 `placedFrame` 开始计时：`childFrame = floor((parentFrame - placedFrame) / parentFps * childFps) % childFrames + 1`。
- matrix-only 的纯 Move 继承原 `placedFrame`；显式放置 character（即使 character 相同、depth 相同）视为新实例并重置计时。父 timeline 回到循环首帧时，子实例也从该轮的放置时刻重新开始。
- 多层嵌套逐层使用各自父帧、父 fps 和放置时刻计算，不把根 elapsed 直接传给所有后代。并列模型层也按各层 fps 从根动作时间换算。

实际样本 `timeline:00423899f2adfbae01d2` 在同一 depth 的第 2 帧显式替换 character，计时重置到第 2 帧；`timeline:01174d5ae5e78688b652` 第 2 帧仅更新 matrix，保留第 1 帧的放置时刻。这两种记录分别来自 `game/data/newplayer1-5.swf` 与 `game/data/particle/texiao_1062-1070.swf`。

## 空间映射

原版 `AnimateSceneObject.setPos` 先用逻辑位置减去 `anchor`；west 使用 `wanchor.x = width * scale - anchor.x`。`DisplayObjectRenderer` 再缩放显示对象并追加位置，因此 anchor 本身不能随模型 scale 再缩放。缺少请求方向时，renderer 使用对向 clip、负 x scale 和 `width * scale` 横向补偿。玩家 body 与 weapon 是同一 renderer 下的子级，共用 body 的这套原点、scale 和镜像。

运行时据此只建立一个公共 renderer 节点：源 anchor 作为未缩放的位置偏移，模型 scale 施加在公共节点；`mountNode` 则按逻辑位置相对量 `(east ? mount.x : -mount.x, -mount.y)` 暴露。这里的 y 符号转换来自 Flash 向下、Cocos 向上的坐标差异。

## 动作句柄

`play(status, direction, onAttack?, onComplete?)` 返回 generation、源帧换算的 `durationSeconds` / `cueSeconds`、`hasNativeState`、完成 Promise 与 cancel。新动作或主动取消会结束旧 Promise，但不会触发旧 cue / complete 回调，供上层按 `atk/hit/walk/die` 优先级持有 generation。

缺少请求状态时返回 `hasNativeState=false`。尤其缺少 `hit` / `die` 时不再用 `stand` 冒充原生状态；缺死亡 timeline 会清空恢复动画显示，实体何时从战斗根节点移除由上层在动作完成或显式缺口规则后决定。攻击 cue 使用源 `attack[0]`（0 时沿用源码第 3 帧默认值），没有固定毫秒常量。

定向回归覆盖延后放置、不同 fps、多层嵌套、同 character 重放置、纯 Move、父循环、旧回调取消、完成回调重入及以上两个实际 timeline 样本。测试中的 Cocos surface 是最小 mock，只验证时序和生命周期；空间映射依据原版源码核对并通过 TypeScript 定向检查，真实 Cocos 画面仍需集成验收。
