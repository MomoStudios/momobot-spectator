import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    const before = sdk.getState()?.player;
    if (!before) throw new Error('No player state');
    const candidates = [
        [before.worldX + 1, before.worldZ],
        [before.worldX, before.worldZ + 1],
        [before.worldX - 1, before.worldZ],
        [before.worldX, before.worldZ - 1]
    ];
    for (const [x, z] of candidates) {
        const result = await bot.walkTo(x, z, 0);
        const after = sdk.getState()?.player;
        if (result.success && after && (after.worldX !== before.worldX || after.worldZ !== before.worldZ)) {
            console.log(JSON.stringify({ before: [before.worldX, before.worldZ], after: [after.worldX, after.worldZ], result: result.message }));
            return;
        }
    }
    throw new Error('Full client accepted control connection but no adjacent tile was reachable');
}, { timeout: 30_000 });
