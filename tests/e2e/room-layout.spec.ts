import { expect, test } from '@playwright/test';

test('room controls and current media fit desktop and mobile after the component upgrade', async ({
	page
}) => {
	const title = 'A long series title for the current media card';
	const summary =
		'Two friends set out to explore a distant world and discover its secrets. '.repeat(8);
	const poster =
		'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#446688"/></svg>';
	await page.route('**/api/runtime-env', (route) =>
		route.fulfill({ json: { backendBaseUrl: '/be', staticBaseUrl: '/static' } })
	);
	await page.route('**/be/auth/plex/session', (route) =>
		route.fulfill({ json: { enabled: true, authenticated: false, canAccessRaw: false } })
	);
	await page.routeWebSocket('**/be/sync/**', () => {});
	await page.route('**/be/rooms/layout-room', (route) =>
		route.fulfill({ json: { roomId: 'layout-room', mediaId: 'layout-fixture' } })
	);
	await page.route('**/be/media/layout-fixture', (route) =>
		route.fulfill({
			json: {
				Id: 'layout-fixture',
				Source: 'processed',
				Input: `${title} - S01E02 - A new beginning.mkv`,
				State: 'complete',
				Duration: 1440,
				year: 2025,
				Poster: '/layout-poster.svg',
				Summary: summary,
				EncodedCodecs: ['h264-8bit'],
				Files: { 'h264-8bit.mp4': 1024 },
				MappedAudio: {},
				Streams: [{ Index: 0, CodecType: 'video', CodecName: 'h264', Width: 1280, Height: 720 }],
				Chapters: [],
				DominantColors: [],
				JobModTime: 1
			}
		})
	);
	await page.route('**/be/layout-poster.svg', (route) =>
		route.fulfill({ contentType: 'image/svg+xml', body: poster })
	);
	await page.route('**/static/layout-fixture/**', (route) => route.fulfill({ status: 404 }));
	await page.route('**/static/pfp/**', (route) => route.fulfill({ status: 404 }));
	await page.route('**/library/sources', (route) => route.fulfill({ json: { sources: [] } }));
	await page.route('**/library/items?*', (route) =>
		route.fulfill({ json: { items: [], total: 0 } })
	);
	await page.goto('/layout-room/media/layout-fixture');
	const join = page.getByRole('button', { name: 'Join Watch Room', exact: true });
	await expect(join).toBeVisible();
	await expect(join).toHaveCSS('border-top-width', '0px');
	const profile = page.getByRole('button', { name: 'Open profile settings', exact: true });
	const media = page.getByRole('region', { name: 'Current media', exact: true });
	await expect(media.getByRole('button', { name: 'Sign in with Plex' })).toBeVisible();
	await expect(media.getByRole('heading', { name: title, exact: true })).toBeVisible();
	await expect(media.getByText('Encoded', { exact: true })).toBeVisible();
	await expect(media.getByText('S01E02 · A new beginning', { exact: true })).toBeVisible();
	await expect(media.getByText('24 min', { exact: true })).toBeVisible();
	await expect
		.poll(() => media.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
		.toBeGreaterThan(0);
	for (const width of [1280, 390, 320]) {
		await page.setViewportSize({ width, height: 844 });
		const returnButton = media.getByRole('button', { name: 'Go back to library', exact: true });
		await expect(returnButton).toBeVisible();
		const returnBounds = await returnButton.boundingBox();
		expect(returnBounds!.x).toBeGreaterThanOrEqual(0);
		expect(returnBounds!.x + returnBounds!.width).toBeLessThanOrEqual(width);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
			.toBeTruthy();
		const geometry = await profile.evaluate((el) => {
			const button = el.getBoundingClientRect();
			const avatar = el.querySelector('[role="img"], img')!.getBoundingClientRect();
			return {
				inset: avatar.left - button.left,
				offset: avatar.top + avatar.height / 2 - (button.top + button.height / 2)
			};
		});
		expect(geometry.inset).toBeCloseTo(2, 0);
		expect(Math.abs(geometry.offset)).toBeLessThan(1);
		await profile.click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
		await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
		const scrollBefore = await page.evaluate(() => window.scrollY);
		await page.mouse.move(10, 400);
		await page.mouse.wheel(0, -200);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollBefore);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
		await media.getByRole('button', { name: 'Change media', exact: true }).click();
		const source = page.getByRole('combobox', { name: 'Source', exact: true });
		await source.click();
		await expect(page.getByRole('option', { name: 'Encoded', exact: true })).toBeVisible();
		await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
		const menu = await page.getByRole('listbox').boundingBox();
		expect(menu!.x).toBeGreaterThanOrEqual(0);
		expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
		await page.getByRole('option', { name: 'Encoded', exact: true }).click();
		await expect(source).toContainText('Encoded');
		await expect(page.getByRole('dialog')).toBeVisible();
		await source.click();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('listbox')).toBeHidden();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
	}
	await media.getByRole('button', { name: 'Read more', exact: true }).click();
	await expect(media.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await expect(media.getByText(summary, { exact: true })).toHaveCSS('-webkit-line-clamp', 'none');
	// Broken artwork must leave the reserved cover space and usable picker, not a broken image.
	await page.route('**/be/layout-poster.svg', (route) => route.fulfill({ status: 404 }));
	await page.reload();
	await expect(media.getByRole('heading', { name: title })).toBeVisible();
	await expect(media.locator('img')).toHaveCount(0);
	await expect(media.getByRole('button', { name: 'Change media', exact: true })).toBeVisible();
});
