import { describe, expect, test } from 'bun:test';
import { SKILL_ICON_NAMES, SKILL_ICON_SOURCE_FRAMES, skillIconIndex } from './public/skill-icons.js';

const EXPECTED_SKILLS = [
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
];

describe('authentic skill icon mapping', () => {
    test('covers every public 2004scape skill in SDK order', () => {
        expect(SKILL_ICON_NAMES).toEqual(EXPECTED_SKILLS);
        expect(EXPECTED_SKILLS.map(skillIconIndex)).toEqual(EXPECTED_SKILLS.map((_, index) => index));
    });

    test('uses the authoritative stats-tab cache frames', () => {
        expect(SKILL_ICON_SOURCE_FRAMES).toEqual([
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
    });

    test('fails closed for placeholder or unknown skills', () => {
        expect(skillIconIndex('Stat18')).toBeNull();
        expect(skillIconIndex('Stat19')).toBeNull();
        expect(skillIconIndex('Sailing')).toBeNull();
    });
});
