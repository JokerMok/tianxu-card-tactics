import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/typescript.js');
const client = path.resolve(import.meta.dirname, '..');
const web = path.resolve(process.argv[2] ?? path.join(client, '..', '交付/系统界面设计对照版-20260927/web'));
const bundlePath = path.join(web, 'assets/main/index.js');
let bundle = await readFile(bundlePath, 'utf8');
function replaceModule(name, compiled) {
  const marker = `System.register("chunks:///_virtual/${name}.ts"`;
  if (!compiled.startsWith(marker)) throw new Error(`${name} compilation failed`);
  const start = bundle.indexOf(marker);
  const end = bundle.indexOf('System.register(', start + marker.length);
  if (start < 0 || end < 0) throw new Error(`Existing ${name} module missing from web bundle`);
  bundle = bundle.slice(0, start) + compiled + '\n\n' + bundle.slice(end);
}
function compile(name, source, dependencies) {
  let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.System } }).outputText;
  compiled = compiled.replace(/^System.register\(\[/, `System.register("chunks:///_virtual/${name}.ts", [`);
  for (const [from, to] of Object.entries(dependencies)) compiled = compiled.replaceAll(JSON.stringify(from), JSON.stringify(to));
  replaceModule(name, compiled);
}
let shellSource = await readFile(path.join(client, 'assets/scripts/meta/GameShell.ts'), 'utf8');
shellSource = shellSource.replace('  Button,\n', '  Button,\n  assetManager,\n  Texture2D,\n');
const signature = '  private loadSprite(path: string, host: Node, width: number, height: number, color = Color.WHITE, onLoaded?: () => void): void {\n';
const fallback = `  private loadSprite(path: string, host: Node, width: number, height: number, color = Color.WHITE, onLoaded?: () => void): void {\n    if (['nav-selected', 'task-rewards', 'resource-icons-v2'].some(name => path === 'ui/components/' + name + '/spriteFrame')) {\n      const file = path.split('/')[2] + '.png';\n      const url = new URL('ui-extra/' + file, globalThis.location.href).href;\n      assetManager.loadRemote(url, { ext: '.png' }, (error, image) => {\n        if (error || !host.isValid) return;\n        const texture = new Texture2D();\n        texture.image = image;\n        const frame = new SpriteFrame();\n        frame.texture = texture;\n        const sprite = host.getComponent(Sprite) ?? host.addComponent(Sprite);\n        sprite.spriteFrame = frame;\n        sprite.sizeMode = Sprite.SizeMode.CUSTOM;\n        sprite.color = color;\n        host.getComponent(UITransform).setContentSize(width, height);\n        onLoaded?.();\n      });\n      return;\n    }\n`;
if (!shellSource.includes(signature)) throw new Error('GameShell.loadSprite signature missing');
compile('GameShell', shellSource.replace(signature, fallback), { './GameState': './GameState.ts' });
compile('CampaignBattleView', await readFile(path.join(client, 'assets/scripts/battle/presentation/CampaignBattleView.ts'), 'utf8'), {
  '../campaign/CampaignSession.ts': './CampaignSession.ts',
  './BattleWidgets': './BattleWidgets.ts',
});
await writeFile(bundlePath, bundle);
await mkdir(path.join(web, 'ui-extra'), { recursive: true });
for (const name of ['nav-selected', 'task-rewards', 'resource-icons-v2']) {
  await copyFile(path.join(client, `assets/resources/ui/components/${name}.png`), path.join(web, `ui-extra/${name}.png`));
}
console.log(`Updated playable UI bundle: ${web}`);
