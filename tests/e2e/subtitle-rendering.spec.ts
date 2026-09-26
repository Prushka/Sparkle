import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import sharp from 'sharp';

let bundle: string;
test.beforeAll(async () => {
	const result = await build({
		stdin: {
			contents:
				"export { RawSubtitles } from './lib/player/raw-subtitles'; export { EMPTY_ASS_TRACK } from './lib/player/subtitle-rendering';",
			resolveDir: process.cwd()
		},
		bundle: true,
		write: false,
		format: 'iife',
		globalName: 'SubtitleFixture',
		platform: 'browser'
	});
	bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 960, height: 540 });
	await page.route('**/subtitle-rendering-fixture', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<style>body{margin:0;background:#111}#stage{position:relative;width:960px;height:540px}</style><div id="stage"></div>'
		})
	);
	await page.goto('/subtitle-rendering-fixture');
	await page.addScriptTag({ content: bundle });
});

test('Raw styled subtitles load Chinese glyphs and compose four shrinking, collision-aware layers', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.evaluate(() => {
		const api = (window as any).SubtitleFixture;
		const root = new api.RawSubtitles(document.getElementById('stage'));
		const header = api.EMPTY_ASS_TRACK.replace(
			'ScriptType: v4.00+',
			'ScriptType: v4.00+\nPlayResX: 960\nPlayResY: 540'
		).replace('Arial,20,', 'Microsoft YaHei,48,');
		(window as any).subtitleFixture = { root, header, layers: [] };
		root.setLanguage('zh-CN');
		root.sink.reset(0x17016, new TextEncoder().encode(header));
		root.sink.packet(new TextEncoder().encode('0,0,Default,,0,0,0,,中文測試字幕'), 0, 10000);
		root.time(1000);
	});
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const group = (window as any).subtitleFixture.root.composition;
					return group.renderer && !group.flushing
						? (await group.renderer.renderer.getEvents()).length
						: 0;
				}),
			{ timeout: 20_000 }
		)
		.toBe(1);
	const png = await page.screenshot({ path: test.info().outputPath('chinese-styled.png') });
	const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const columns: number[] = [];
	for (let x = 0; x < info.width; x++) {
		let ink = false;
		for (let y = 380; y < info.height; y++) {
			if (data[(y * info.width + x) * 3] > 160) {
				ink = true;
				break;
			}
		}
		if (ink) columns.push(x);
	}
	// Tofu boxes repeat the same glyph. Real ideographs have distinct ink masks.
	const spans: number[][] = [];
	for (const x of columns) {
		const last = spans.at(-1);
		if (!last || x > last[1] + 1) spans.push([x, x]);
		else last[1] = x;
	}
	expect(spans.length).toBeGreaterThanOrEqual(6);
	const glyphs = spans.map(([left, right]) => {
		let mask = '';
		for (let y = 380; y < info.height; y++)
			for (let x = left; x <= right; x++) mask += data[(y * info.width + x) * 3] > 160 ? '1' : '0';
		return mask;
	});
	expect(new Set(glyphs).size).toBeGreaterThanOrEqual(4);
	await page.evaluate(() => {
		const { root, header, layers } = (window as any).subtitleFixture;
		for (const text of ['English subtitles', '日本語の字幕', '第四字幕']) {
			const layer = root.createLayer();
			layers.push(layer);
			const smallerScript = header
				.replace('PlayResX: 960', 'PlayResX: 320')
				.replace('PlayResY: 540', 'PlayResY: 180')
				.replace('Microsoft YaHei,48,', 'Microsoft YaHei,16,');
			layer.sink.reset(0x17016, new TextEncoder().encode(smallerScript));
			layer.sink.packet(new TextEncoder().encode(`0,0,Default,,0,0,0,,${text}`), 0, 10000);
			layer.time(1000);
		}
	});
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const group = (window as any).subtitleFixture.root.composition;
				if (group.flushing) return [];
				return (await group.renderer.renderer.getStyles())
					.filter((style: any) => style.Name.startsWith('sparkle_'))
					.map((style: any) => style.FontSize);
			})
		)
		.toEqual([33.6, 33.6, 33.6, 33.6]);
	await expect(page.locator('[data-raw-subtitle-composition="ass"]')).toHaveCount(1);
	await page.screenshot({ path: test.info().outputPath('four-styled-layers.png') });
	await page.evaluate(() =>
		(window as any).subtitleFixture.layers.forEach((layer: any) => layer.destroy())
	);
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const group = (window as any).subtitleFixture.root.composition;
				if (group.flushing) return 0;
				const events = await group.renderer.renderer.getEvents();
				const styles = await group.renderer.renderer.getStyles();
				return styles[events[0]?.Style]?.FontSize;
			})
		)
		.toBe(48);
	await page.evaluate(() => (window as any).subtitleFixture.root.destroy());
	await expect(page.locator('canvas')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('Raw text layers share Encoded sizing, line stacking, seek clearing and teardown', async ({
	page
}) => {
	await page.evaluate(() => {
		const root = new (window as any).SubtitleFixture.RawSubtitles(document.getElementById('stage'));
		const layers = [root, ...Array.from({ length: 4 }, () => root.createLayer())];
		(window as any).subtitleFixture = { root, layers };
		layers.forEach((layer: any, index: number) => {
			layer.sink.reset(0x17012, new Uint8Array());
			layer.sink.packet(new TextEncoder().encode(`Subtitle ${index + 1}`), 0, 10000);
			layer.time(1000);
		});
	});
	const text = page.locator('[data-raw-subtitle-composition="text"]');
	await expect(text).toHaveText('Subtitle 1\nSubtitle 2\nSubtitle 3\nSubtitle 4\nSubtitle 5');
	const small = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	await page.evaluate(() =>
		(window as any).subtitleFixture.layers.splice(1).forEach((layer: any) => layer.destroy())
	);
	await expect(text).toHaveText('Subtitle 1');
	await expect
		.poll(() => text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
		.toBeGreaterThan(small);
	await page.evaluate(() => (window as any).subtitleFixture.root.clear());
	await expect(text).toBeEmpty();
	await page.evaluate(() => (window as any).subtitleFixture.root.destroy());
	await expect(page.locator('#stage')).toBeEmpty();
});
