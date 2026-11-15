/**
 * DOG Weihnachtsdorf · verbindliche Kostenformel für künftige Gebäude-Upgrades.
 *
 * Die Weihnachtslichter gehören später zum gemeinsamen, serverseitig
 * verwalteten Dorfvorrat. Diese reine Berechnung bucht selbst nichts ab
 * und darf kein Event freischalten oder lokale Vorschau als Besitz werten.
 */
export const CHRISTMAS_BUILDING_IDS=Object.freeze(['tower','workshop','bakery','inn']);
export const CHRISTMAS_BUILDING_MIN_LEVEL=1;
export const CHRISTMAS_BUILDING_MAX_LEVEL=5;
export const CHRISTMAS_BASE_UPGRADE_COST=15;

/** Preis für den Schritt `currentLevel → currentLevel + 1`.
 * Auf Maximalstufe oder bei ungültigem Level: null (kein kaufbares Upgrade).
 */
export function christmasUpgradeCost(currentLevel){
 if(!Number.isInteger(currentLevel)||currentLevel<CHRISTMAS_BUILDING_MIN_LEVEL||currentLevel>=CHRISTMAS_BUILDING_MAX_LEVEL)return null;
 return CHRISTMAS_BASE_UPGRADE_COST*2**(currentLevel-1);
}

/** Kumulierte, theoretisch benötigte Lichter ab Level 1, nicht ein Guthaben. */
export function christmasBuildingTotalCost(level){
 if(!Number.isInteger(level)||level<CHRISTMAS_BUILDING_MIN_LEVEL||level>CHRISTMAS_BUILDING_MAX_LEVEL)return null;
 return CHRISTMAS_BASE_UPGRADE_COST*(2**(level-1)-1);
}

/** Ein unverbindliches Angebot. Spätere Abbuchung muss atomar im Backend erfolgen. */
export function christmasUpgradeQuote(level,availableLights){
 const cost=christmasUpgradeCost(level);
 if(cost===null||!Number.isSafeInteger(availableLights)||availableLights<0)return null;
 return Object.freeze({
  fromLevel:level,toLevel:level+1,cost,
  affordable:availableLights>=cost,
  remainingLights:availableLights>=cost?availableLights-cost:availableLights
 });
}

/** Vier Gebäudestufen müssen vollständig und gültig sein. */
export function christmasVillageTotalCost(levels){
 if(!levels||typeof levels!=='object'||Array.isArray(levels)||
    Object.keys(levels).length!==CHRISTMAS_BUILDING_IDS.length||
    !CHRISTMAS_BUILDING_IDS.every(id=>Object.hasOwn(levels,id)))return null;
 const costs=CHRISTMAS_BUILDING_IDS.map(id=>christmasBuildingTotalCost(levels[id]));
 return costs.some(cost=>cost===null)?null:costs.reduce((sum,cost)=>sum+cost,0);
}
