# 归档的共享骨架实验

2026-10-27用户确认方案C：正式19种角色继续逐帧，不迁移现有兵种。本目录在Creator的`assets/`之外；补绘源稿仍在`art-source/rig-experiment/`。

独立重建：项目根执行`bash tools/art-samples/build-rig-experiment.command`；随后`bash tools/art-samples/start-rig-experiment.command`，访问`http://127.0.0.1:7462/?rigbench=1&mode=side&count=4`。

构建器只向`.local/rig-experiment/source-overlay`复制实验模块，并将两份小补丁应用于**临时副本**；不覆盖正式播放器源码。原正式入口的meta/场景身份复用，实验资源单独复制到`.local/rig-experiment/art`。补丁上下文不匹配会失败，不能悄悄覆盖后来修复。不得为修复归档构建而恢复正式入口的实验导入。

正式构建不设置`P0_SOURCE_OVERLAY`；本地诊断脚本必须显式使用`stage-local.py --diagnostics`。正式打包器拒绝实验或本地诊断混入。历史比较与来源详见`documentation/art-samples/rig-experiment/README.md`，本轮只确认归档入口能独立启动，没有重新比较或制作资源。
