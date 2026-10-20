import { _decorator } from 'cc';
import { TianxuGame } from '../game/TianxuGame.ts';
const { ccclass } = _decorator;
/** Scene identity is retained; implementation now uses the authoritative game service. */
@ccclass('BattleA0Bootstrap')
export class BattleA0Bootstrap extends TianxuGame {}
