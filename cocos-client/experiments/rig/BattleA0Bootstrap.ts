import { _decorator } from 'cc';
import { TianxuGame } from '../game/TianxuGame.ts';
import {RigComparisonScene} from '../game/RigComparisonScene.ts';
const { ccclass } = _decorator;
/** Scene identity is retained; implementation now uses the authoritative game service. */
@ccclass('BattleA0Bootstrap')
export class BattleA0Bootstrap extends TianxuGame {
  private comparison?:RigComparisonScene;
  onLoad(){if(RigComparisonScene.requested()){this.comparison=new RigComparisonScene(this.node);void this.comparison.load();return;}super.onLoad();}
  update(dt:number){if(this.comparison)this.comparison.update(dt);else super.update(dt);}
  onDestroy(){if(this.comparison)this.comparison.destroy();else super.onDestroy();}
}
