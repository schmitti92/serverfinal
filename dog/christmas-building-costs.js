/**
 * DOG Weihnachtsdorf · verbindliche Kostenformel für künftige Gebäude-Upgrades.
 *
 * Die Weihnachtslichter gehören später zum gemeinsamen, serverseitig
 * verwalteten Dorfvorrat. Diese reine Berechnung bucht selbst nichts ab
 * und darf kein Event freischalten oder lokale Vorschau als Besitz werten.
 */
// All six shared village buildings contribute equally to the Christmas tree.
// Keep the legacy TREE name as an alias so existing imports remain compatible.
export const CHRISTMAS_BUILDING_IDS=Object.freeze(['tower','workshop','bakery','inn','luckhouse','academy']);
export const CHRISTMAS_TREE_BUILDING_IDS=CHRISTMAS_BUILDING_IDS;
export const CHRISTMAS_BUILDING_MIN_LEVEL=1;
export const CHRISTMAS_BUILDING_MAX_LEVEL=5;
export const CHRISTMAS_BASE_UPGRADE_COST=15;
// Every following upgrade costs three times the previous one.
export const CHRISTMAS_UPGRADE_COST_MULTIPLIER=3;

/** Preis für den Schritt `currentLevel → currentLevel + 1`.
 * Auf Maximalstufe oder bei ungültigem Level: null (kein kaufbares Upgrade).
 */
export function christmasUpgradeCost(currentLevel){
 if(!Number.isInteger(currentLevel)||currentLevel<CHRISTMAS_BUILDING_MIN_LEVEL||currentLevel>=CHRISTMAS_BUILDING_MAX_LEVEL)return null;
 return CHRISTMAS_BASE_UPGRADE_COST*CHRISTMAS_UPGRADE_COST_MULTIPLIER**(currentLevel-1);
}

/** Kumulierte, theoretisch benötigte Lichter ab Level 1, nicht ein Guthaben. */
export function christmasBuildingTotalCost(level){
 if(!Number.isInteger(level)||level<CHRISTMAS_BUILDING_MIN_LEVEL||level>CHRISTMAS_BUILDING_MAX_LEVEL)return null;
 return CHRISTMAS_BASE_UPGRADE_COST*(CHRISTMAS_UPGRADE_COST_MULTIPLIER**(level-1)-1)/(CHRISTMAS_UPGRADE_COST_MULTIPLIER-1);
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

/** All six building levels must be valid. */
export function christmasVillageTotalCost(levels){
 if(!levels||typeof levels!=='object'||Array.isArray(levels)||
    Object.keys(levels).length!==CHRISTMAS_BUILDING_IDS.length||
    !CHRISTMAS_BUILDING_IDS.every(id=>Object.hasOwn(levels,id)))return null;
 const costs=CHRISTMAS_BUILDING_IDS.map(id=>christmasBuildingTotalCost(levels[id]));
 return costs.some(cost=>cost===null)?null:costs.reduce((sum,cost)=>sum+cost,0);
}
