# UI 资产拆层清单

范围：Image2-v1 的九张正式 UI 视觉稿。每个界面按背景、角色、装饰、九宫格、图标、文字、状态各记录一项；每项均记录其来源图。`availability: "absent"` 仅记录视觉依据中的缺失类别，不可当作资产使用。

ID 规则：`UI编号-层级代码-序号`。层级代码依次为 BG、CHR、DEC、9S、ICO、TXT、STA；验证器解析下列清单并校验全部 63 项。

<!-- asset-layer-inventory:start -->
~~~json
{
  "schemaVersion": 1,
  "screens": [
    {
      "id": "UI01",
      "name": "主城",
      "source": "UI01-主城.png",
      "layers": [
        {
          "id": "UI01-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "云海仙山与主城广场",
          "reusable": false,
          "verification": "中央至远景为云海、山峰、楼阁与石阶。",
          "source": "UI01-主城.png"
        },
        {
          "id": "UI01-CHR-01",
          "layer": "角色",
          "availability": "present",
          "asset": "左侧红黑甲持剑主将",
          "reusable": false,
          "verification": "左侧前景可见完整男性持剑立绘。",
          "source": "UI01-主城.png"
        },
        {
          "id": "UI01-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "顶部纹样、右侧战旗与石栏",
          "reusable": true,
          "verification": "顶部、右侧和底部有独立玉石金属纹样与旗帜。",
          "source": "UI01-主城.png"
        },
        {
          "id": "UI01-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "章节牌、目标框与按钮边框",
          "reusable": true,
          "verification": "中央章节牌、右侧目标牌和继续征战按钮均有框体。",
          "source": "UI01-主城.png"
        },
        {
          "id": "UI01-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "资源、导航与底部入口图标",
          "reusable": true,
          "verification": "资源栏、九项导航和三个底部入口均有图标。",
          "source": "UI01-主城.png"
        },
        {
          "id": "UI01-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "章节、关卡、目标、导航与资源文字",
          "reusable": true,
          "verification": "中央和四周均有可读文字。",
          "source": "UI01-主城.png"
        },
        {
          "id": "UI01-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "主城选中与目标进度",
          "reusable": true,
          "verification": "主城高亮，今日目标显示 3/4、0/1 与进度条。",
          "source": "UI01-主城.png"
        }
      ]
    },
    {
      "id": "UI02",
      "name": "征战",
      "source": "UI02-征战.png",
      "layers": [
        {
          "id": "UI02-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "白鹿古道山川战役地图",
          "reusable": false,
          "verification": "主区域为山川、水道与城寨战役地图。",
          "source": "UI02-征战.png"
        },
        {
          "id": "UI02-CHR-01",
          "layer": "角色",
          "availability": "absent",
          "asset": null,
          "reusable": false,
          "verification": "未见独立人物或生物立绘；地图节点和场景不算角色。",
          "source": "UI02-征战.png"
        },
        {
          "id": "UI02-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "龙纹挂饰、卷轴与罗盘",
          "reusable": true,
          "verification": "详情牌上方有龙纹挂饰，底部案面有卷轴和罗盘。",
          "source": "UI02-征战.png"
        },
        {
          "id": "UI02-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "详情牌、奖励格与操作按钮框",
          "reusable": true,
          "verification": "右侧关卡牌、奖励格和按钮均为带角饰框体。",
          "source": "UI02-征战.png"
        },
        {
          "id": "UI02-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "关卡、锁、星级、奖励与导航图标",
          "reusable": true,
          "verification": "地图有编号节点、锁和星级，详情牌有奖励图标。",
          "source": "UI02-征战.png"
        },
        {
          "id": "UI02-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "主线征战、关卡条件、战力与按钮文字",
          "reusable": true,
          "verification": "左上和右侧详情牌均有文字。",
          "source": "UI02-征战.png"
        },
        {
          "id": "UI02-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "征战选中、已通关与锁定关卡",
          "reusable": true,
          "verification": "征战高亮；1至4有星级，5至12显示锁定。",
          "source": "UI02-征战.png"
        }
      ]
    },
    {
      "id": "UI03",
      "name": "卡库",
      "source": "UI03-卡库.png",
      "layers": [
        {
          "id": "UI03-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "云海城阙与石质地台",
          "reusable": false,
          "verification": "卡牌后方可见云海、宫阙、山峰和地台。",
          "source": "UI03-卡库.png"
        },
        {
          "id": "UI03-CHR-01",
          "layer": "角色",
          "availability": "present",
          "asset": "卡牌内单位与法术人物插画",
          "reusable": false,
          "verification": "多张卡牌包含弓手、守卫和术士人物图像。",
          "source": "UI03-卡库.png"
        },
        {
          "id": "UI03-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "兽首、旗帜与金属花纹",
          "reusable": true,
          "verification": "右侧详情牌顶部有兽首，边缘有旗帜和纹样。",
          "source": "UI03-卡库.png"
        },
        {
          "id": "UI03-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "卡牌外框、详情牌与升级按钮框",
          "reusable": true,
          "verification": "十二张卡、右侧详情区和升级按钮都有边框。",
          "source": "UI03-卡库.png"
        },
        {
          "id": "UI03-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "导航、费用角标与单位类别图标",
          "reusable": true,
          "verification": "导航、卡牌左上角和类别行均有图标。",
          "source": "UI03-卡库.png"
        },
        {
          "id": "UI03-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "卡名、等级、收藏进度与详情属性",
          "reusable": true,
          "verification": "卡牌、顶部与右侧均有文字。",
          "source": "UI03-卡库.png"
        },
        {
          "id": "UI03-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "卡库选中与折锋枪兵详情选中",
          "reusable": true,
          "verification": "卡库高亮，右侧详情为折锋枪兵。",
          "source": "UI03-卡库.png"
        }
      ]
    },
    {
      "id": "UI04",
      "name": "编队",
      "source": "UI04-编队.png",
      "layers": [
        {
          "id": "UI04-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "云海城景与军械桌",
          "reusable": false,
          "verification": "编队板后方为云海宫阙，前景为军械桌。",
          "source": "UI04-编队.png"
        },
        {
          "id": "UI04-CHR-01",
          "layer": "角色",
          "availability": "present",
          "asset": "十张编队卡内单位与技能插画",
          "reusable": false,
          "verification": "两行十张卡均含单位或技能人物图像。",
          "source": "UI04-编队.png"
        },
        {
          "id": "UI04-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "兵器架、香炉、卷轴与桌面玉饰",
          "reusable": true,
          "verification": "左右兵器架、左下香炉卷轴和底部玉饰独立可见。",
          "source": "UI04-编队.png"
        },
        {
          "id": "UI04-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "编队板、卡框、检查牌与按钮框",
          "reusable": true,
          "verification": "中央板、十个卡框、右侧检查牌和按钮均有框体。",
          "source": "UI04-编队.png"
        },
        {
          "id": "UI04-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "导航、单位类别、技能火焰与检查图标",
          "reusable": true,
          "verification": "导航、卡牌类别与技能卡均有图标。",
          "source": "UI04-编队.png"
        },
        {
          "id": "UI04-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "编队、卡名、10/10 与检查文字",
          "reusable": true,
          "verification": "中央、卡牌和右侧检查牌均有文本。",
          "source": "UI04-编队.png"
        },
        {
          "id": "UI04-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "编队选中与数量上限通过",
          "reusable": true,
          "verification": "编队高亮，检查牌显示 10/10、8/8、2/2。",
          "source": "UI04-编队.png"
        }
      ]
    },
    {
      "id": "UI05",
      "name": "主将",
      "source": "UI05-主将.png",
      "layers": [
        {
          "id": "UI05-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "山城庭院与石质地面",
          "reusable": false,
          "verification": "人物与装备架后方为山城、旗帜和庭院地面。",
          "source": "UI05-主将.png"
        },
        {
          "id": "UI05-CHR-01",
          "layer": "角色",
          "availability": "present",
          "asset": "岳沉戈主将立绘",
          "reusable": false,
          "verification": "左中区域可见完整持剑红黑甲人物，名字标为岳沉戈。",
          "source": "UI05-主将.png"
        },
        {
          "id": "UI05-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "旗帜、装备架角饰与流苏",
          "reusable": true,
          "verification": "左侧旗帜和右侧装备架的角饰、流苏独立可见。",
          "source": "UI05-主将.png"
        },
        {
          "id": "UI05-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "属性框、装备槽与切换职业按钮框",
          "reusable": true,
          "verification": "五条属性、三个装备槽和按钮均有边框容器。",
          "source": "UI05-主将.png"
        },
        {
          "id": "UI05-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "生命、攻势、护甲、术强、统御与导航图标",
          "reusable": true,
          "verification": "五条属性左侧和导航均有图标。",
          "source": "UI05-主将.png"
        },
        {
          "id": "UI05-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "标题、角色名、等级、属性与按钮文字",
          "reusable": true,
          "verification": "标题、岳沉戈、Lv.8、数值和按钮文字清晰可见。",
          "source": "UI05-主将.png"
        },
        {
          "id": "UI05-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "主将导航选中",
          "reusable": true,
          "verification": "左侧主将条目以绿色高亮显示。",
          "source": "UI05-主将.png"
        }
      ]
    },
    {
      "id": "UI06",
      "name": "历练",
      "source": "UI06-历练.png",
      "layers": [
        {
          "id": "UI06-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "云海山峦与石阶试炼场景",
          "reusable": false,
          "verification": "三座试炼门后方为山峦、云海和石阶。",
          "source": "UI06-历练.png"
        },
        {
          "id": "UI06-CHR-01",
          "layer": "角色",
          "availability": "present",
          "asset": "吞厢玄龟 Boss",
          "reusable": false,
          "verification": "右侧试炼门内可见带甲壳的大型玄龟生物。",
          "source": "UI06-历练.png"
        },
        {
          "id": "UI06-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "试炼门龙纹、玉珠流苏与旗帜",
          "reusable": true,
          "verification": "三座门框有龙纹、玉珠和流苏，右侧有旗帜。",
          "source": "UI06-历练.png"
        },
        {
          "id": "UI06-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "试炼门标题牌、名称牌与挑战按钮框",
          "reusable": true,
          "verification": "每座试炼门均有标题牌、名称牌和挑战按钮。",
          "source": "UI06-历练.png"
        },
        {
          "id": "UI06-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "导航与试炼门主题图标",
          "reusable": true,
          "verification": "左侧导航和三座试炼门顶部均有图形标识。",
          "source": "UI06-历练.png"
        },
        {
          "id": "UI06-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "副本、挑战塔、Boss、名称与挑战文字",
          "reusable": true,
          "verification": "三座门的标题、名称和按钮均有文本。",
          "source": "UI06-历练.png"
        },
        {
          "id": "UI06-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "历练导航选中",
          "reusable": true,
          "verification": "左侧历练条目以绿色高亮显示。",
          "source": "UI06-历练.png"
        }
      ]
    },
    {
      "id": "UI07",
      "name": "营造",
      "source": "UI07-营造.png",
      "layers": [
        {
          "id": "UI07-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "浮空城、山峦与瀑布",
          "reusable": false,
          "verification": "主体为多层城寨、浮岛、瀑布与远山。",
          "source": "UI07-营造.png"
        },
        {
          "id": "UI07-CHR-01",
          "layer": "角色",
          "availability": "absent",
          "asset": null,
          "reusable": false,
          "verification": "未见独立人物或生物立绘；建筑、飞艇与城景不算角色。",
          "source": "UI07-营造.png"
        },
        {
          "id": "UI07-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "飞艇、旗帜、锻炉火光与玉石细节",
          "reusable": true,
          "verification": "右侧有飞艇旗帜，左下有锻炉火光和建筑细节。",
          "source": "UI07-营造.png"
        },
        {
          "id": "UI07-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "建筑名称牌、升级与派遣按钮框",
          "reusable": true,
          "verification": "四处建筑名称牌和操作按钮均为边框容器。",
          "source": "UI07-营造.png"
        },
        {
          "id": "UI07-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "导航与建筑交互图标",
          "reusable": true,
          "verification": "左侧导航和建筑交互区均有图形标识。",
          "source": "UI07-营造.png"
        },
        {
          "id": "UI07-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "标题、建筑等级、升级与派遣文字",
          "reusable": true,
          "verification": "标题、四处建筑名称和操作按钮均有文本。",
          "source": "UI07-营造.png"
        },
        {
          "id": "UI07-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "营造导航选中",
          "reusable": true,
          "verification": "左侧营造条目以绿色高亮显示。",
          "source": "UI07-营造.png"
        }
      ]
    },
    {
      "id": "UI08",
      "name": "任务",
      "source": "UI08-任务.png",
      "layers": [
        {
          "id": "UI08-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "云海城景与案台",
          "reusable": false,
          "verification": "任务卷轴后方可见云海、城景和案台。",
          "source": "UI08-任务.png"
        },
        {
          "id": "UI08-CHR-01",
          "layer": "角色",
          "availability": "absent",
          "asset": null,
          "reusable": false,
          "verification": "未见独立人物或生物立绘；任务图标不算角色。",
          "source": "UI08-任务.png"
        },
        {
          "id": "UI08-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "卷轴轴杆、旗帜、龙像与案面器物",
          "reusable": true,
          "verification": "任务列表为卷轴，右侧有旗帜龙像，底部有器物。",
          "source": "UI08-任务.png"
        },
        {
          "id": "UI08-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "任务行、奖励格、领取与前往按钮框",
          "reusable": true,
          "verification": "三条任务行、奖励格和操作按钮均有边框。",
          "source": "UI08-任务.png"
        },
        {
          "id": "UI08-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "活跃度奖励、任务类型、货币、水晶与导航图标",
          "reusable": true,
          "verification": "上方奖励、任务行左侧和奖励格均有图标。",
          "source": "UI08-任务.png"
        },
        {
          "id": "UI08-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "任务、活跃、条件、进度与操作文字",
          "reusable": true,
          "verification": "标题、活跃度、三条任务和按钮均有文本。",
          "source": "UI08-任务.png"
        },
        {
          "id": "UI08-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "任务选中与任务完成进度",
          "reusable": true,
          "verification": "任务高亮，三行显示 3/3、1/1、0/1。",
          "source": "UI08-任务.png"
        }
      ]
    },
    {
      "id": "UI09",
      "name": "行囊",
      "source": "UI09-行囊.png",
      "layers": [
        {
          "id": "UI09-BG-01",
          "layer": "背景",
          "availability": "present",
          "asset": "工坊、货架与山城远景",
          "reusable": false,
          "verification": "物品柜周围可见工坊结构、货架和山城远景。",
          "source": "UI09-行囊.png"
        },
        {
          "id": "UI09-CHR-01",
          "layer": "角色",
          "availability": "absent",
          "asset": null,
          "reusable": false,
          "verification": "未见独立人物或生物立绘；物品图像不算角色。",
          "source": "UI09-行囊.png"
        },
        {
          "id": "UI09-DEC-01",
          "layer": "装饰",
          "availability": "present",
          "asset": "旗帜、宝箱、卷轴与案面器物",
          "reusable": true,
          "verification": "物品柜周围有旗帜、宝箱、卷轴和金属器物。",
          "source": "UI09-行囊.png"
        },
        {
          "id": "UI09-9S-01",
          "layer": "九宫格",
          "availability": "present",
          "asset": "物品格、分类标签、详情牌与使用按钮框",
          "reusable": true,
          "verification": "十五个物品格、分类标签、详情牌和按钮均为框体。",
          "source": "UI09-行囊.png"
        },
        {
          "id": "UI09-ICO-01",
          "layer": "图标",
          "availability": "present",
          "asset": "分类、物品、水晶与导航图标",
          "reusable": true,
          "verification": "顶部分类栏、物品格、详情大图和导航均有图标。",
          "source": "UI09-行囊.png"
        },
        {
          "id": "UI09-TXT-01",
          "layer": "文字",
          "availability": "present",
          "asset": "标题、分类、数量、强化石说明与使用文字",
          "reusable": true,
          "verification": "顶部标题、数量、右侧说明和按钮均有文本。",
          "source": "UI09-行囊.png"
        },
        {
          "id": "UI09-STA-01",
          "layer": "状态",
          "availability": "present",
          "asset": "行囊选中与全部分类选中",
          "reusable": true,
          "verification": "左侧行囊和顶部全部分类均以绿色高亮显示。",
          "source": "UI09-行囊.png"
        }
      ]
    }
  ]
}
~~~
<!-- asset-layer-inventory:end -->
