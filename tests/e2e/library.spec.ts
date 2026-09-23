import { expect, test, type Page } from '@playwright/test';

const show = {
	id: 'processed-show-fixture',
	source: 'processed',
	kind: 'show',
	title: 'A long series title for library navigation',
	children: 2,
	duration: 0,
	poster: '/library-test/poster.svg'
};
const season = {
	id: `${show.id}-1`,
	source: 'processed',
	kind: 'season',
	title: 'Season 1',
	index: 1,
	duration: 0,
	poster: show.poster
};

async function fixture(page: Page) {
	await page.route('**/library/sources', (route) =>
		route.fulfill({
			json: { sources: [{ id: '1', source: 'plex', title: 'A very long Plex library name' }] }
		})
	);
	await page.route('**/library-test/poster.svg', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#446688"/></svg>'
		})
	);
	await page.route('**/library/items?*', (route) => {
		const url = new URL(route.request().url());
		const start = Number(url.searchParams.get('cursor') || 0);
		return route.fulfill({
			json: {
				total: 144,
				nextCursor: start < 96 ? String(start + 48) : undefined,
				items: Array.from({ length: 48 }, (_, i) =>
					start + i === 0
						? show
						: {
								id: `movie-${start + i}`,
								source: i % 2 ? 'plex' : 'processed',
								kind: 'movie',
								title: `Movie ${start + i}`,
								duration: 120,
								poster: show.poster
							}
				)
			}
		});
	});
	await page.route(`**/library/items/${show.id}/children?*`, (route) =>
		route.fulfill({
			json: {
				items: season.title
					.toLowerCase()
					.includes(new URL(route.request().url()).searchParams.get('query')?.toLowerCase() || '')
					? [season]
					: [],
				total: 1
			}
		})
	);
	await page.route(`**/library/items/${season.id}/children?*`, (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: 'episode-fixture',
						source: 'processed',
						kind: 'episode',
						title: 'First episode',
						index: 1,
						duration: 100,
						poster: show.poster
					}
				],
				total: 1
			}
		})
	);
}

test('Library history preserves the room, filters and hierarchy on back, forward and reload', async ({
	page
}) => {
	await fixture(page);
	await page.goto('/?keep=room-context');
	await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
	const roomPath = new URL(page.url()).pathname;
	await page.getByRole('combobox', { name: 'Sort library', exact: true }).click();
	await page.getByRole('option', { name: 'Title A–Z', exact: true }).click();
	await page.getByRole('button', { name: /Encoded A long series title/ }).click();
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	await page.getByRole('button', { name: /Encoded Season 1/ }).click();
	await expect(page.getByRole('link', { name: /Encoded.*First episode/ })).toHaveAttribute(
		'href',
		new RegExp(`^${roomPath}/media/episode-fixture\\?`)
	);
	await page.reload();
	await expect(page.getByRole('link', { name: /Encoded.*First episode/ })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('button', { name: /Encoded A long series title/ })).toBeVisible();
	await page.goForward();
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	await page.getByRole('button', { name: 'Back to parent', exact: true }).click();
	await expect(page.getByRole('button', { name: /Encoded A long series title/ })).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(roomPath);
	expect(new URL(page.url()).searchParams.get('keep')).toBe('room-context');
	await expect(page.getByRole('combobox', { name: 'Sort library' })).toContainText('Title A–Z');
});

test('search stays within its level and restores parent searches without stale debounce navigation', async ({
	page
}) => {
	await fixture(page);
	await page.goto('/?keep=search-context');
	const search = page.getByRole('searchbox', { name: 'Search library' });
	const hierarchy = page.getByRole('navigation', { name: 'Library hierarchy' });
	await expect(search).toBeVisible();
	const roomPath = new URL(page.url()).pathname;
	await search.fill('series');
	await expect(page).toHaveURL(/query=series/);
	await page.getByRole('button', { name: /Encoded A long series title/ }).click();
	await expect(search).toHaveValue('');
	await expect(search).toHaveAttribute('placeholder', 'Search seasons');
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	await search.fill('Season');
	await expect(page).toHaveURL(/query=Season/);
	await expect(hierarchy.getByRole('button', { name: show.title, exact: true })).toBeVisible();
	await page.getByRole('button', { name: /Encoded Season 1/ }).click();
	await expect(search).toHaveValue('');
	await expect(search).toHaveAttribute('placeholder', 'Search episodes');
	await expect(page.getByRole('link', { name: /First episode/ })).toBeVisible();
	await page.reload();
	await expect(search).toHaveValue('');
	await page.getByRole('button', { name: 'Back to parent' }).click();
	await expect(search).toHaveValue('Season');
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	await hierarchy.getByRole('button', { name: 'Library', exact: true }).click();
	await expect(search).toHaveValue('series');
	await page.getByRole('button', { name: 'Clear search' }).click();
	await expect(search).toHaveValue('');
	await expect(page).not.toHaveURL(/[?&]query=/);
	// Clear before the debounce fires; it must never restore the text later.
	await search.fill('pending');
	await page.getByRole('button', { name: 'Clear search' }).click();
	await page.waitForTimeout(600);
	await expect(search).toHaveValue('');
	await expect(page).not.toHaveURL(/[?&]query=/);
	// Entering a hierarchy cancels an uncommitted search as well.
	await search.fill('obsolete');
	await page.getByRole('button', { name: /Encoded A long series title/ }).click();
	await page.waitForTimeout(600);
	await expect(search).toHaveValue('');
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('button', { name: /Encoded A long series title/ })).toBeVisible();
	await expect(search).toHaveValue('');
	await page.goForward();
	await expect(page.getByRole('button', { name: /Encoded Season 1/ })).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(roomPath);
	expect(new URL(page.url()).searchParams.get('keep')).toBe('search-context');
});

test('Library selects allow background scrolling and keyboard selection', async ({ page }) => {
	await fixture(page);
	await page.goto('/');
	const source = page.getByRole('combobox', { name: 'Source', exact: true });
	await source.click();
	await expect(page.getByRole('listbox')).toBeVisible();
	await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
	await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
	const grid = page.getByLabel('Library titles', { exact: true });
	const bounds = (await grid.boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.wheel(0, 500);
	await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
	await page.keyboard.press('Escape');
	await source.focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('listbox')).toBeVisible();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await expect(source).toContainText('Plex · Raw');
});

test('Library controls and popups fit narrow mobile, tablet and desktop layouts', async ({
	page
}) => {
	await fixture(page);
	await page.goto('/');
	const search = page.getByRole('searchbox', { name: 'Search library' });
	await search.fill('hello');
	await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toHaveCount(1);
	await expect(search).toHaveAttribute('type', 'text'); // No browser-native second clear button.
	await page.getByRole('button', { name: 'Clear search', exact: true }).click();
	await expect(search).toHaveValue('');
	for (const width of [320, 390, 768, 1366]) {
		await page.setViewportSize({ width, height: 844 });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
			.toBeTruthy();
		for (const name of ['Source', 'Plex library', 'Sort library']) {
			const select = page.getByRole('combobox', { name, exact: true });
			await expect(select).toBeVisible();
			await expect(select).toHaveCSS('cursor', 'pointer');
			await expect
				.poll(async () => {
					const box = await select.boundingBox();
					return !!box && box.x >= 0 && box.x + box.width <= width;
				})
				.toBeTruthy();
			await select.click();
			const list = page.getByRole('listbox');
			await expect(list).toBeVisible();
			const box = await list.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(width);
			await page.keyboard.press('Escape');
		}
		const filters = await page.getByLabel('Library filters', { exact: true }).boundingBox();
		const nav = await page.getByRole('navigation', { name: 'Library hierarchy' }).boundingBox();
		expect(nav!.y - (filters!.y + filters!.height)).toBeGreaterThanOrEqual(12);
		await expect(page.getByRole('textbox', { name: 'Room URL or ID' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'TV Shows', exact: true })).toBeVisible();
	}
});

test('virtualized covers load after scrolling without hover', async ({ page }) => {
	await fixture(page);
	await page.goto('/');
	const grid = page.getByLabel('Library titles', { exact: true });
	await expect(grid.locator('img').first()).toBeVisible();
	for (let i = 0; i < 4; i++) {
		await grid.evaluate((el) => {
			el.scrollTop += el.clientHeight;
		});
		await expect
			.poll(() =>
				grid
					.locator('img')
					.evaluateAll(
						(images) =>
							images.length > 0 &&
							images.every(
								(image) =>
									(image as HTMLImageElement).complete &&
									(image as HTMLImageElement).naturalWidth > 0
							)
					)
			)
			.toBeTruthy();
		for (const image of await grid.locator('img').all())
			await expect(image).toHaveAttribute('loading', 'eager');
	}
	expect(await grid.locator('img').count()).toBeLessThan(100);
});
