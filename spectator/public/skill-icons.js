// Exact 2004scape cache mapping from player/interfaces/stats.if.
// Fishing's omitted graphic component is identified by the original fish frame.
export const SKILL_ICON_SOURCE_FRAMES = Object.freeze([
    'staticons,0',
    'staticons,2',
    'staticons,1',
    'staticons,6',
    'staticons,3',
    'staticons,4',
    'staticons,5',
    'staticons,15',
    'staticons,17',
    'staticons,11',
    'staticons,14',
    'staticons,16',
    'staticons,10',
    'staticons,13',
    'staticons,12',
    'staticons,8',
    'staticons,7',
    'staticons,9',
    'staticons2,0'
]);

export const SKILL_ICON_NAMES = Object.freeze([
    'Attack',
    'Defence',
    'Strength',
    'Hitpoints',
    'Ranged',
    'Prayer',
    'Magic',
    'Cooking',
    'Woodcutting',
    'Fletching',
    'Fishing',
    'Firemaking',
    'Crafting',
    'Smithing',
    'Mining',
    'Herblore',
    'Agility',
    'Thieving',
    'Runecraft'
]);

const SKILL_ICON_INDEX = new Map(SKILL_ICON_NAMES.map((name, index) => [name, index]));

export function skillIconIndex(name) {
    return SKILL_ICON_INDEX.has(name) ? SKILL_ICON_INDEX.get(name) : null;
}
