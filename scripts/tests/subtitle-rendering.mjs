import { build } from 'esbuild';
import assert from 'node:assert/strict';
const bundle = await build({
	entryPoints: ['lib/player/subtitle-rendering.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node'
});
const {
	EMPTY_ASS_TRACK,
	assPacketDialogue,
	normalizeAssRendererFonts,
	parseAssDocument,
	serializeMergedAss
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const header = EMPTY_ASS_TRACK.replace(
	'ScriptType: v4.00+',
	'ScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080'
);
const chunk =
	'15,0,Default,,10,20,30,,{\\fs20\\pos(320,300)\\move(0,0,640,360,10,500)\\clip(0,0,640,360)\\rDefault}中文, test';
const dialogue = assPacketDialogue(chunk, 1230, 2340);
assert.match(dialogue, /^Dialogue: 0,0:00:01.23,0:00:03.57,Default,,10,20,30,,/);
assert.ok(dialogue.endsWith('中文, test'));
assert.equal(
	assPacketDialogue(dialogue, 0, 0),
	dialogue,
	'libmedia Dialogue packets are already complete'
);
const primary = parseAssDocument(header + dialogue, { language: 'en-US' });
const smaller = parseAssDocument(
	normalizeAssRendererFonts(
		header.replace('1920', '640').replace('1080', '360') + dialogue,
		'zh-CN'
	),
	{ language: 'zh-CN' }
);
const merged = parseAssDocument(serializeMergedAss([primary, smaller]), { language: 'en-US' });
assert.equal(merged.styles[0].values.fontsize, '17.6');
assert.equal(
	merged.styles[1].values.fontsize,
	'52.8',
	'font size follows the authored script resolution'
);
assert.equal(merged.styles[1].values.fontname, 'Noto Sans SC Thin');
assert.equal(merged.events[1].values.marginl, '26');
assert.equal(merged.events[1].values.marginr, '53');
assert.equal(merged.events[1].values.marginv, '79');
assert.ok(merged.events[1].values.text.includes('\\fs52.8'));
assert.ok(merged.events[1].values.text.includes('\\pos(960,900)'));
assert.ok(
	merged.events[1].values.text.includes('\\move(0,0,1920,1080,10,500)'),
	'animation times stay unchanged'
);
assert.ok(merged.events[1].values.text.includes('\\clip(0,0,1920,1080)'));
assert.ok(merged.events[1].values.text.includes('\\rsparkle_1_Default'));
assert.equal(merged.events[1].startTime, 1.23);
assert.equal(merged.events[1].endTime, 3.57);
assert.equal(
	normalizeAssRendererFonts(header, 'jpn'),
	normalizeAssRendererFonts(header, 'ja-JP'),
	'raw codec language codes use the same font fallback as Encoded locales'
);
const attachment = normalizeAssRendererFonts(
	header.replace('Arial,20,', 'My Embedded Font,20,'),
	'zh-CN'
);
assert.ok(
	attachment.includes('My Embedded Font,20,'),
	'custom attachment fonts retain their names'
);
console.log(
	'ASS packet envelopes, multilingual fallback, style isolation and mixed-resolution coordinates passed'
);
