import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This is a reversible animation experiment. It reuses the existing cutout sheet
// unchanged, so every crop and joint can be checked against the source image.
const project = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(project, 'assets/resources/art/battle/units/U002/U002-CUTOUT-SHEET.png');
const output = join(project, 'assets/resources/art/battle/units/U002/codex-pilot');
const stem = 'U002-CODEX-PILOT';
mkdirSync(output, { recursive: true });
copyFileSync(source, join(output, `${stem}_tex.png`));

// Atlas rectangles refer to the detached parts in the bottom-left quadrant.
// target is the desired centre on the source sheet's standing figure, relative
// to a foot anchor at (180, 999). Positive Y points down in DragonBones data.
const parts = [
  { name: 'rearSkirt', rect: [329, 812, 145, 169], target: [0, -100], bone: 'pelvis' },
  { name: 'leftLeg', rect: [267, 811, 30, 158], target: [-25, -110], bone: 'leftLeg' },
  { name: 'rightLeg', rect: [303, 811, 28, 158], target: [30, -110], bone: 'rightLeg' },
  { name: 'leftFoot', rect: [108, 967, 45, 32], target: [-28, -16], bone: 'leftFoot' },
  { name: 'rightFoot', rect: [210, 967, 39, 32], target: [39, -16], bone: 'rightFoot' },
  // The upper 73 pixels of this bounding rectangle also contain a loose hair
  // island from the adjacent cell. The face attachment already supplies hair.
  { name: 'torso', rect: [112, 650, 143, 279], target: [3, -209], bone: 'torso' },
  { name: 'leftArm', rect: [40, 673, 41, 135], target: [-65, -259], bone: 'leftArm' },
  { name: 'rightArm', rect: [251, 702, 30, 91], target: [62, -252], bone: 'rightArm' },
  { name: 'leftShoulder', rect: [266, 642, 54, 48], target: [-51, -312], bone: 'torso' },
  { name: 'rightShoulder', rect: [408, 642, 53, 47], target: [68, -312], bone: 'torso' },
  { name: 'head', rect: [61, 579, 48, 73], target: [5, -366], bone: 'head' },
  { name: 'spear', rect: [472, 571, 29, 423], target: [-75, -216], bone: 'spear' },
  { name: 'shield', rect: [502, 779, 64, 204], target: [92, -118], bone: 'shield' },
];
const atlas = {
  name: stem, imagePath: `${stem}_tex.png`, width: 1536, height: 1024,
  SubTexture: parts.map(({ name, rect: [x, y, width, height] }) => ({ name, x, y, width, height })),
};

const bones = [
  { name: 'root', at: [0, 0] },
  { name: 'pelvis', parent: 'root', at: [0, -158] },
  { name: 'leftLeg', parent: 'pelvis', at: [-27, 0] },
  { name: 'rightLeg', parent: 'pelvis', at: [29, 0] },
  { name: 'leftFoot', parent: 'leftLeg', at: [-2, 127] },
  { name: 'rightFoot', parent: 'rightLeg', at: [6, 127] },
  { name: 'torso', parent: 'pelvis', at: [0, -89] },
  { name: 'head', parent: 'torso', at: [0, -119] },
  { name: 'leftArm', parent: 'torso', at: [-65, -95] },
  { name: 'rightArm', parent: 'torso', at: [65, -95] },
  { name: 'spear', parent: 'leftArm', at: [-39, 71] },
  { name: 'shield', parent: 'rightArm', at: [29, 119] },
];
const absolute = new Map();
for (const bone of bones) {
  const parent = absolute.get(bone.parent) ?? [0, 0];
  absolute.set(bone.name, [parent[0] + bone.at[0], parent[1] + bone.at[1]]);
}
const skinSlots = parts.map(part => {
  const pivot = absolute.get(part.bone);
  return {
    name: part.name,
    display: [{ name: part.name, type: 'image', path: part.name,
      transform: { x: part.target[0] - pivot[0], y: part.target[1] - pivot[1] },
      pivot: { x: .5, y: .5 },
    }],
  };
});
const rotate = (name, values) => ({ name, rotateFrame: values.map(([duration, rotate]) => ({ duration, rotate, tweenEasing: 0 })) });
const translate = (name, values) => ({ name, translateFrame: values.map(([duration, x, y]) => ({ duration, x, y, tweenEasing: 0 })) });
const scale = (name, values) => ({ name, scaleFrame: values.map(([duration, x, y]) => ({ duration, x, y, tweenEasing: 0 })) });
const actions = (segments) => segments.map(([duration, event]) => event ? { duration, actions: [{ type: 10, name: event }] } : { duration });
const animation = [
  { name: 'Idle', duration: 36, playTimes: 0, bone: [
    translate('torso', [[18, 0, 0], [18, 0, -3]]),
    rotate('head', [[18, -1], [18, 1]]),
    rotate('spear', [[18, -2], [18, 2]]),
  ] },
  { name: 'Move', duration: 24, playTimes: 0, bone: [
    translate('pelvis', [[6, 0, 0], [6, 0, -5], [6, 0, 0], [6, 0, -5]]),
    rotate('leftLeg', [[6, -8], [6, 0], [6, 8], [6, 0]]),
    rotate('rightLeg', [[6, 8], [6, 0], [6, -8], [6, 0]]),
    rotate('spear', [[12, -2], [12, 2]]),
  ] },
  { name: 'Attack', duration: 24, playTimes: 1,
    frame: actions([[5], [8, 'windup'], [11, 'impact']]),
    bone: [
      translate('pelvis', [[5, 0, 0], [8, -12, 0], [3, -26, -2], [8, 0, 0]]),
      rotate('torso', [[5, 0], [8, -7], [3, 8], [8, 0]]),
      rotate('leftArm', [[5, 0], [8, -24], [3, 42], [8, 0]]),
      rotate('spear', [[5, 0], [8, -23], [3, 22], [8, 0]]),
      rotate('rightArm', [[5, 0], [8, -8], [3, 13], [8, 0]]),
    ] },
  { name: 'Hit', duration: 12, playTimes: 1,
    frame: actions([[2], [10, 'hit']]),
    bone: [
      translate('pelvis', [[2, 0, 0], [3, 12, 0], [7, 0, 0]]),
      rotate('torso', [[2, 0], [3, 9], [7, 0]]),
      rotate('head', [[2, 0], [3, -7], [7, 0]]),
      rotate('shield', [[2, 0], [3, -12], [7, 0]]),
    ] },
  { name: 'Death', duration: 24, playTimes: 1,
    frame: actions([[22], [2, 'despawn']]),
    bone: [
      translate('pelvis', [[5, 0, 0], [8, 9, 25], [11, 20, 48]]),
      rotate('torso', [[5, 0], [8, 15], [11, 62]]),
      rotate('head', [[5, 0], [8, -9], [11, 16]]),
      scale('root', [[14, 1, 1], [10, .92, .82]]),
    ] },
];
const skeleton = {
  name: stem, version: '5.5', compatibleVersion: '5.5', frameRate: 30,
  armature: [{
    name: 'U002', type: 'Armature', frameRate: 30,
    aabb: { x: -170, y: -430, width: 360, height: 430 },
    bone: bones.map(({ name, parent, at }) => ({ name, ...(parent ? { parent } : {}), transform: { x: at[0], y: at[1] } })),
    slot: parts.map(({ name, bone }) => ({ name, parent: bone, displayIndex: 0 })),
    skin: [{ name: 'default', slot: skinSlots }],
    animation, defaultActions: [{ gotoAndPlay: 'Idle' }],
  }],
};
writeFileSync(join(output, `${stem}_tex.json`), `${JSON.stringify(atlas, null, 2)}\n`);
writeFileSync(join(output, `${stem}_ske.json`), `${JSON.stringify(skeleton, null, 2)}\n`);
console.log(`Generated ${stem} in ${output}`);
