# 次级玩家窗口源结构映射

实现入口：`cocos-client/assets/scripts/game/SecondaryWindows.ts`。组件直接消费当前 `/api/state` 的 `tasks`、`social`、`rooms`、`roomInvites`、`rankings`、`actor.settings`、`assetNames` 和 `assetIcons`，所有修改动作沿用现有后端 action。

| 页面 | 源类与坐标结构 | 当前实现 |
| --- | --- | --- |
| 邮件 | `MailWnd` `(277,70)`、`709×473`；`LeftMail` / `RightMail` 左右分栏；底部领取、删除按钮 | 已绑定 `youjian`、`yjliebiao_2/3/4`、`yjneirong_2/3`；左侧分页目录，右侧正文、附件和操作；写信使用真实 `EditBox`；`mail.read/claim/delete/send` 全部可达 |
| 任务 | `TaskWnd` `(280,40)`；`TaskLeftPane` 宽 `195`；`TaskRightPane` 详情和奖励区 | 已绑定 `yjdi`；左侧任务目录，右侧说明、奖励和领取；新手引导与正式任务共用源分栏 |
| 社交 | `SocialWnd` `(890,20)`、`279×509`；顶部 `PlayerInfo`，中部好友/公会页签，底部按钮 | 已绑定 `sjbeijing_1`、好友/公会页签、搜索及加好友图；好友、申请、聊天分页；搜索角色及世界/私聊使用真实 `EditBox`；公会进入独立正式窗口 |
| 公会 | `GongHuiZoneWnd` 全屏 `gonghuidating_1`；公会信息约在左侧 `(20,-20)`；等级信息 `(450,40)`；成员列表 `(470,155)`；左右事务按钮区 | 已改用 `gonghuidating_1` 全屏原图；未入会时在主内容区叠加 `gonghuiliebiao`。公会摘要、成员分页和事务操作按源分区放置；申请、创建、捐献、聊天、技能、入会审核、移交、城战和退出仍沿用现有 action |
| 交易 | `TradeCityWnd` 全屏 | 已绑定 `tradecitywnd` 全屏原图且不再使用背景占位；左侧可交易资产，右侧交易/拍卖双页；物品使用 `assetIcons` 源图；交易、上架、邮寄、竞价、一口价和撤回均可达 |
| 房间大厅 | `RoomListPane` 位于 `(35,95)`，`GridList` 为 3 列、水平间距 18、垂直间距 8；`PvPRoomInfoListCell` 为 `299×125`，名称、人数、状态和观战入口分别位于单元内部固定位置 | 已改用 `PVPfjlb` 大厅原图和 3×2 的每页六房间排列，替代此前 2 列 `520×74` 通用列表。每格使用原 `fangjianliebiaoditu`，竞技房叠加 `PVPjingjizhan`，名称、人数和状态按 AS3 坐标放置。当前服务没有观战 action，因此不伪造观战按钮；整格仍执行已有邀请接受、加入或进入房间动作 |
| 创建竞技房 | `CreatPVPRoomWnd` 在窗口内选择对战类型和 `1V1/2V2/4V4`，再确认创建 | 已把人数选择从通用 `choose` 弹窗移入房间窗口，并接入 `PVPjingjizhan` / `PVPlianxisai` 两张原类型图。服务只接受竞技 `pvp + teamSize`，所以练习赛原图明确标为服务未开放，仅竞技战和 1/2/4 人队伍选项可提交 |
| 房间内页 | `AbstractRoomWnd` 全屏 `PVPfjbeijing`；队伍区约 `(10,0)`、房间信息在右上、操作区在底部；`UserInfoPane` 为 `227×205` 的 2×2 队伍格，角色动画区为 `(7,12)`、`185×185`；练习房可并列两组；底部按钮使用房间专用皮肤 | 玩家格按 2×2 源尺寸排列；8 人竞技房使用两组并列 2×2。空位使用 `PVPfjrwbeijing_3`；已入座玩家按服务返回的真实职业和性别加载恢复角色动画，玩家名、等级、公会、`fangzhu` 房主章和 `ready` 准备章按源位置叠加。早期存档没有 `gender` 字段，房间页与服务战斗、成长预览统一按男性兼容；职业缺失时仍明确显示身份缺失，不代填默认战士。异步帧图挂载后会逐帧重试适配 `185×185` 区域；动画无法加载或持续没有可测绘制帧时显示该玩家真实职业图标并明确标为无法显示。未变化的房间轮询复用当前动画实例，成员、身份、准备或房间状态变化时销毁旧实例并重建。右侧房间/个人信息使用 `PVPfjxx` / `PVPgrxx`。邀请、准备、取消准备、开始分别使用 PVPPVE 容器中的 `fjyq_1.jpg`、`fjzb_1.jpg`、`fjqx_1.jpg`、`fjks_1.jpg`；离开、返回及继续战斗仍沿用现有 action，继续战斗直接进入 `battle` |
| 排行 | `RankingWnd` 全屏；左侧 `WinnerPane` `(80,68)`、右侧 `RankingPane` 约 `(542,70)`；`RankListCell` 六列宽度依次为 42、200、90、96、63、128，行高 33；1v1/2v2/竞技赛页签 | 已绑定全屏背景和三组页签图；右侧按六列显示名次、玩家、职业、积分、胜率、等级并使用 33 行高。服务快照没有战力字段，因此末列明确使用真实等级；原选中行 `phbpmbeijing_7` 未导入，个人行使用同尺寸高亮面板。2v2/竞技赛页签进入现有功能入口 |
| 设置 | `SystemSetWnd` `(420,107)`、`431×336`；声音区、滑杆、交互复选框和确定/取消 | 已绑定 `xtszbj_1` 并按源尺寸与主要坐标布局；音乐、音效用滑杆语义显示，拒绝私聊/邀请使用复选语义；确定一次提交 `settings.save`，并保留切换角色、退出登录 |

`import-original-ui.py` 现会扫描 `GamePackageUI` 下的房间列表、`RoomUI`、`UserInfoUI` 和排行单元源码；`original-ui.json` 已从现有逆向位图导入 `fangjianliebiaoditu`、`PVPjingjizhan`、`PVPlianxisai`、`PVPfjrwbeijing_3`、`fangzhu`、`fjyq_1.jpg` 和 `fjzb_1.jpg`。`phbpmbeijing_7` 只在 `RankListCell.as` 中出现；当前 `assets.json` 和全部已解析 SWF `symbol_dictionary` 均无此符号或转换位图，因此个人排行选中行继续使用同尺寸高亮面板，这是现有逆向资料中的真实缺口。玩家格中央使用与原版同类的运行时角色动画，职业图标只承担动画加载失败时的真实身份回退。通用按钮由 `CocosUi.button` 使用已恢复的 `ajda_1`；普通小窗关闭按钮使用 `guanbi`。
