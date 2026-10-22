import type { RecoveredCatalog, RecoveredCard } from './RecoveredContent.ts';
export interface DisplayAbility { id:string; name:string; text:string; status:string }
export interface CardDisplay { id:string;name:string;originalName:string;nameStatus:string;nameEvidence:string;type:string;race:string;raceId:number;quality:number;ready:number;attack?:number;hp?:number;unique:number;art:string;abilities:DisplayAbility[];flavor:string;profession:number;frame:string }
export interface GameLocalization { cards:Record<string,{name:string;status:string;source:string}>;effects:Record<string,{name:string;text:string;status:string}>;skills:Record<string,{name:string;text:string;status:string}>; }
export const RACES:Record<number,string>={1:'人类',2:'亡灵',3:'野兽',4:'哥布林',5:'食人魔',6:'精灵',7:'兽人',8:'异界',9:'龙族',10:'天使',11:'恶魔',12:'圣军',13:'仙灵',14:'半精灵',15:'暗巨魔',16:'多头龙',17:'艾什魔',100:'战士',101:'游侠',102:'法师',103:'牧师'};
export const PROFESSIONS=['不限','战士','游侠','法师','牧师'];

// Presentation-only localization. Raw scene IDs and source names remain unchanged.
const PRESENTATION_ZH: Record<string, string> = {
  'Shimmering Cave':'微光洞窟','Dark Forest':'昏暗森林','Sanguine Tribe':'血腥部落','Windy Cliff':'狂风悬崖',
  'Desert Fortress':'沙漠要塞','Castle of Bones':'白骨城堡',"King's Mausoleum":'地下王陵','Ancient Den':'远古兽穴',
  "Dragon's Lair":'红龙洞窟',"Heaven's Rapture":'云中神殿',"Hell's Realm":'地狱边境','Human Gate Pass':'人类关隘',
  'Elven Wildwood':'精灵荒林','Ghastly Graveyard':'亡灵墓园','Furred Fury':'兽人狂境','Goblin Labyrinth':'哥布林迷宫',
  'Ogre Campsite':'食人魔营地','Beasts Jungle':'野兽丛林','Explorer Union':'探险者联盟',"Exploring the Dragon's Lair":'红龙洞窟探险',
  'Heavenly trials':'天界试炼',"Devil's Abyss":'恶魔深渊','Chaotic Wastes':'混沌荒原','Pet Magic Realm':'宠物秘境',
  'Mystic Valley':'神秘山谷','Hero Coming':'英雄降临','Endless Abyss':'无尽深渊','Sanctuary of Heroic Souls':'英灵圣殿',
  'Top of Paralysis':'麻痹之巅','Love Unto Death':'至死不渝','Thousand Years of Love':'千年之恋','Lucky Journey':'幸运之旅',
  'Halloween Cave':'万圣洞窟','Karsa Awakening':'卡萨觉醒','Winter Wonderland':'冬日仙境',"Yearly Bane's Pursuit":'年兽追击',
  "Fool's Wonderland":'愚人秘境','Harvest Triumph':'丰收凯歌','Tome Hall 1':'典籍大厅一层','Tome Hall 2':'典籍大厅二层',
  'Tome Hall 3':'典籍大厅三层','Tome Hall 4':'典籍大厅四层','Tome Hall 5':'典籍大厅五层','Tome Hall 6':'典籍大厅六层',
  'Tome Hall 7':'典籍大厅七层','Tome Hall 8':'典籍大厅八层','Tome Hall 9':'典籍大厅九层','Tome Hall 10':'典籍大厅十层',
  'Carnival':'狂欢庆典','Beach Party':'沙滩派对','Back-to-School':'开学季','Moon Across Miles':'千里共婵娟',
  'Spooky Party':'惊魂派对','Autumn Ode':'秋日颂歌','Dawn Epoch':'破晓纪元','Spring Ride':'春日巡游',
  "Heartwoods' Whisper":'心木低语','Easter Frenzy':'复活节狂欢','Artisan’s Trial':'匠人试炼','Fairy Tale Dreamland':'童话梦境',
  'Eternal Continent':'永恒大陆','Golden Sands':'金沙秘境','Frozen Inferno':'冰封炼狱','Starlit Bridge':'星光之桥','Moonlit Realm':'月华秘境',
  'Cathedral of the Goddess':'女神大教堂','Eastern Church Grounds':'东部教会领地','Border farm':'边境农场',
  'Town of Folksvangur':'福克斯万格镇','Town Hall':'市政厅','Highway Fort':'大道要塞','Hillside Sentry Tower':'山腰哨塔',
  'Hilly Mountain Road':'丘陵山路','Stone Ruins':'石砌废墟','Resting Grounds':'安息之地','Snow-covered Slope':'覆雪山坡',
  'Knifes-Edge Mountain Path':'刃脊山道','Snowy Fort':'雪原要塞','Wild Grasslands':'荒野草原','Mystical Cairns':'神秘石冢',
  'Eastern Grasslands':'东部草原','Verdant Pastures':'青翠牧场','Nine Forks River':'九岔河','Floresco, the Sea of Flowers':'弗洛雷斯科花海',
  'Highland Entrance':'高地入口','Border Campsite':'边境营地','Throne of the Lion':'雄狮王座','Mountain Road Fortress':'山道堡垒',
  'Caverns of Blood':'鲜血洞窟','Crusaders Folly':'圣战军遗迹','Rough Valley road':'崎岖谷道','Headwind Valley Road':'逆风谷道',
  'Straight Ravine Road':'笔直峡谷道',"'Abatis' Blockade":'鹿砦封锁线','Ravine Mouth':'峡谷口','Stained Marshes':'污浊沼泽',
  'Scrubby Marsh':'灌木沼泽','Dense Fog Forest':'浓雾森林','Forest Tree Houses':'林间树屋','Faint Southern Path':'隐约南径',
  'Faint Northern Path':'隐约北径','Eastern Mud Flats':'东部滩涂','Western Mud Flats':'西部滩涂','Whistling Graveyard':'呼啸墓园',
  'Bone Ridge Mountain':'白骨岭','Twilight Forest':'暮光森林','The Great Vine':'巨藤','Treeburrow':'树穴',
  'Floris Gloom':'弗洛里斯幽谷','Abandoned Campfire':'废弃营火','Cabin in the Woods':'林间小屋','Desolate Ridge':'荒芜山脊',
  'Shadowbend':'暗影弯道','The Hanging Tree':'吊人树','The Barrows':'古冢','Shadekeep Wall':'影堡城墙',
  'Shadekeep Ruins':'影堡废墟','Elven Outpost':'精灵前哨','The Waste Road':'荒原之路','The Mystlands':'迷雾之地',
  "Dragon's Wing Pass":'龙翼隘口','The Heart Tree':'心灵古树','Spine Ridge':'脊骨山岭',"Verathel's End":'维拉瑟尔终境',
  'The Desolation':'荒芜之境','Ancient City Wall':'古城墙','The Ruined City':'废都','The Lonely Tower':'孤塔',
  'Temple of Flame':'烈焰神殿','Goblin Treehouse':'哥布林树屋',"Canyon's Embrace":'峡谷环抱处',"Heaven's Road":'天界之路',
  "Hell's Road":'地狱之路','Reptiles Haven':'爬行兽栖地','Hot Rocks':'炽热岩地','Sulfur Alley':'硫磺小径',
  'Pyroclastic Falls':'熔岩瀑布','The Bonefields':'白骨原野','Gryffin Roost':'狮鹫巢穴','Welcoming Shore':'迎宾海岸',
  'Temple of Judgement':'审判神殿','Goblin Market':'哥布林集市','Goblin Dock':'哥布林码头','Fist Valley Entrance':'拳谷入口',
  'Fist Valley Peak':'拳谷之巅','Ogre Cave':'食人魔洞穴','Sand River Channel':'沙河河道','End of Sand River':'沙河尽头',
  'Island in the Sand':'沙中孤岛','Deadwood Castle':'枯木城堡','Sand Sculpture Forest':'沙雕森林','Dragon Sand Sculpture':'巨龙沙雕',
  'Third Temple':'第三神殿','Mystery Entrance':'神秘入口','Road exploration':'道路探索','Mist Crossing':'迷雾渡口',
  'ancient ruins':'远古遗迹','Mysterious Treasure Hunt':'神秘寻宝','Cliff Pier':'悬崖码头','Camp Breakout':'突围营地',
  'Mysterious Crystal':'神秘水晶','Weird Town':'诡异小镇','trap cracking':'破解陷阱','hidden secret passage':'隐秘通道',
  'Final Battle':'最终决战','Foothills Town':'山麓小镇','Mountain Trail':'山间小径','Snowy Mountain Entrance':'雪山入口',
  'Snowy Mountain Path':'雪山之路','Snowy Skeleton':'雪地骸骨','Snowy Mountain Trail':'雪山小径','Snowy Trail':'雪地小径',
  'Snowy Secret Area':'雪山秘境','Beast Trail':'野兽踪迹','Beast Trail tribe':'兽迹部落','Snowy Peak Cloud Trail':'雪峰云径',
  'Snowy Peak Fire Realm':'雪峰火境','Archaeological Island':'遗迹之岛','Snow Mountain Island':'雪山之岛','Battle Island':'战斗之岛',
  'Lava Road':'熔岩之路','Lava Island':'熔岩之岛','Forest Trail':'森林小径','Forest Island':'森林之岛',
  'Waterfall Island':'瀑布之岛','Magic Island':'魔法之岛','Healing Island':'治愈之岛','Mountaineering':'攀登险峰',
  'Mystical Church':'神秘教堂','Endless Wastes':'无尽荒原','Mirage City':'海市蜃楼','Bone Sands':'白骨沙海',
  'Dimensional Rift':'次元裂隙','Astral Hall':'星界大厅','Void Realm':'虚空之境','Wailing Abyss':'哀嚎深渊',
  'Soul Cavern':'灵魂洞窟','Bloodlands':'鲜血之地','Scorch Hell':'灼热地狱','Cursed Lair':'诅咒巢穴',
  'Dragongrave':'巨龙墓地','Mistveil Grove':'雾幕林地','Soulflow':'灵魂之流','Bloomlure Vale':'诱花谷',
  'Shadowthorn Woods':'影棘森林','Starfall Well':'星陨之井','Gloomrift Gorge':'幽暗裂谷','Harbor of Lost Mists':'迷雾失港',
  'Dragonbreach Rift':'龙痕裂隙','Mithral Echo':'秘银回响','Moonveil Marsh':'月幕沼泽','Whisperwind Canyons':'风语峡谷',
  'Duskfall Ruins':'暮落遗迹','Lost Crossroads':'迷失岔路','Cold Moon Garrison':'冷月要塞','Slumbering Cemetery':'沉眠墓园',
  'Abandoned Tower':'废弃高塔','Roadside Bone Pile':'路旁骨堆','Dead Tree Woods':'枯木林','Glittering Path':'闪光小径',
  'Old Castle Outpost':'古堡前哨','Ancient Vampire Castle':'远古吸血鬼城堡','Skeletal Throne':'骸骨王座','Starfall Forest':'星陨森林',
  'Withered forest':'枯萎森林','Sacred Mound':'圣丘','Rocky slope':'碎石坡','Sand dunes':'沙丘',
  'Temple Ruins':'神殿遗迹','Mirages':'幻景','Dragon Bones':'龙骨荒地','Crescent Moon Harbour':'新月港',
  'Shifting Desert':'流沙荒漠','Castle Ruins':'城堡废墟','Abandoned Scout Tower':'废弃侦察塔','Village Ruins':'村庄遗迹',
  'Blood-washed Wilderness':'血染荒野','City Gates':'城门','City Bazaar':'城中集市','Cloudless Sanctuary':'晴空圣所',
  'Academy':'学院','Wind-Swept Pagoda':'风扫宝塔',"Ayer's Square":'艾尔广场','Imperial Furnaces':'皇家熔炉',
  'Wailing Wind Courtyard':'哀风庭院','Shrine of Emrys':'埃姆里斯神殿','Snowy Mountain Road':'雪山道路','Cavern Tunnel':'洞窟隧道',
  'Cave Mouth':'洞口','Foggy Mountain':'雾山','Lesser Pine Forest':'小松林','Hot Spring Woodlands':'温泉林地',
  'Aire River Ford':'艾尔河浅滩','Forest Entrance':'森林入口','Thornbush Bridge':'荆棘桥','Aire Riverbank':'艾尔河岸',
  "Heaven's Scar Breach":'天痕缺口','Entwined Branches Waterfall':'盘枝瀑布','Belladonna Harbour':'颠茄港','Illusionary Harbour':'幻影港',
  'Roadside Camp':'路旁营地','Forest of Life':'生命森林',
};

export function presentationName(raw: string): string {
  const normalized = String(raw ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const translated = PRESENTATION_ZH[normalized];
  if (translated) return translated;
  const chapter = normalized.match(/^Chapter\s+(\d+)$/i);
  if (chapter) return `第${chapter[1]}章`;
  const destination = normalized.match(/^Go to Chapter\s+(\d+)$/i);
  if (destination) return `前往第${destination[1]}章`;
  return normalized.replace(/BOSS/gi, '首领').replace(/VIP/g, '贵宾').replace(/地精/g, '哥布林').replace(/巨魔(?=贵宾)/g, '食人魔');
}
export function cardName(catalog:RecoveredCatalog,id:string){const key=String(id).split(':').at(-1)!;return catalog.localization?.cards['main:card:'+key]?.name??String(catalog.scopes.main.cards[key]?.raw.Name??id);}
export function effectDisplay(catalog:RecoveredCatalog,id:string|number):DisplayAbility {const e=catalog.scopes.main.effects[String(id)],t=catalog.localization?.effects['main:effect:'+id];return {id:'main:effect:'+id,name:t?.name||String(e?.Name||'待核对技能'),text:t?.status==='missing'?'原资料未提供完整技能说明，待核对。':t?.text||String(e?.EffectDes||'原资料未提供完整技能说明，待核对。'),status:t?.status??'missing'};}
export function activeCard(catalog:RecoveredCatalog,c:RecoveredCard){const r=c.raw;return !/废弃|\(Abandoned\)/i.test(String(r.Name))&&((Number(r.Type)===1&&Boolean(catalog.scopes.main.monsters[String(r.MonsterID)]))||(Number(r.Type)===2&&Boolean(catalog.scopes.main.skills[String(r.SkillID)])));}
export function cardDisplay(catalog:RecoveredCatalog,c:RecoveredCard,base:string):CardDisplay {const r=c.raw,m=catalog.scopes.main.monsters[String(r.MonsterID)],sk=catalog.scopes.main.skills[String(r.SkillID)]?.raw,loc=catalog.localization?.cards[c.id];const type=Number(r.Type)===2?'技能':'兵种',race=Number(m?.Phyle??r.Race??0);let abilities:DisplayAbility[]=[];
 if(type==='兵种'&&m)abilities=[1,2,3,4,5].map(i=>m['ability'+i]).filter(id=>catalog.scopes.main.effects[String(id)]).map(id=>effectDisplay(catalog,String(id)));
 else {const t=catalog.localization?.skills[c.id];abilities=[{id:'main:skill:'+r.SkillID,name:loc?.name??cardName(catalog,c.id),text:t?.status==='missing'?'原资料未提供完整技能说明，待核对。':t?.text??String(r.Des??sk?.Des??''),status:t?.status??'missing'}];}
 const frames=['renleikuang','renleikuang','wanglingkuang','yeshoukuang','dijingkuang','jumokuang','jinglingkuang','shourenkuang','yijiekuang','longzukuang','tianshikuang','emokuang','ronghekuang_shengjun','ronghekuang_xianling','ronghekuang_banjingling','ronghekuang_anjumo','ronghekuang_duotoulong','ronghekuang_aishimo'];
 return {id:c.id,name:cardName(catalog,c.id),originalName:String(r.Name),nameStatus:loc?.status??'missing',nameEvidence:loc?.source??'',type,raceId:race,race:RACES[race]??'特殊',quality:Number(r.Quality??0),ready:Number(r.InitReady??0),attack:m?Number(m.Attack):undefined,hp:m?Number(m.HP):undefined,unique:Number(m?.Unique??0),art:catalog.assets[c.art[0]]?.path?base+'/recovered/'+catalog.assets[c.art[0]].path:'',abilities,flavor:String(r.BGDes??'').replace(/<[^>]+>/g,''),profession:Number(sk?.['使用职业']??(race>=100&&race<=103?race-99:0)),frame:type==='技能'||race>=100?'jineng':frames[race]??'renleikuang'};}

const sourceNameMaps=new WeakMap<RecoveredCatalog,Map<string,string>>();
export function sourceDisplayName(catalog:RecoveredCatalog,name:string){let names=sourceNameMaps.get(catalog);if(!names){names=new Map();for(const c of Object.values(catalog.scopes.main.cards)){const shown=catalog.localization?.cards[c.id];if(shown)names.set(String(c.raw.Name),shown.name);}sourceNameMaps.set(catalog,names);}return names.get(name)??presentationName(name);}
