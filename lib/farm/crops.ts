// Crop definitions and the pure, timestamp-derived growth model.
//
// Growth is computed on every client from a plot's timestamps so all clients
// agree without any server-side simulation. A plot reaches ripeness at:
//   ripeAt = plantedAt + growthMs - min(waterCount, maxWater) * waterBoostMs
// Watering shaves time off the remaining growth (and is gated by a cooldown so
// it can't be spammed). The visible stage is a fraction of that progress.

import type { FarmPlotSyncState } from '@/lib/player/t';

export interface CropDef {
	id: string;
	label: string;
	/** Row in crops.png (5 stage columns per row). */
	row: number;
	/** Number of growth-stage sprites used (columns 0..stages-1). */
	stages: number;
	/** Base time to ripen with no watering (ms). */
	growthMs: number;
	/** Time removed from remaining growth per effective watering (ms). */
	waterBoostMs: number;
	/** Maximum waterings that count toward growth. */
	maxWater: number;
	/** Accent color for the HUD / particles. */
	tint: number;
}

// Rows verified against sprout premium "Farming Plants.png" (5 cols x 15 rows).
export const CROPS: CropDef[] = [
	{
		id: 'carrot',
		label: 'Carrot',
		row: 2,
		stages: 4,
		growthMs: 90_000,
		waterBoostMs: 16_000,
		maxWater: 4,
		tint: 0xe8843c
	},
	{
		id: 'cauliflower',
		label: 'Cauliflower',
		row: 3,
		stages: 4,
		growthMs: 140_000,
		waterBoostMs: 22_000,
		maxWater: 5,
		tint: 0xeae3c8
	},
	{
		id: 'beet',
		label: 'Beet',
		row: 4,
		stages: 4,
		growthMs: 120_000,
		waterBoostMs: 20_000,
		maxWater: 4,
		tint: 0xc23a6b
	},
	{
		id: 'eggplant',
		label: 'Eggplant',
		row: 5,
		stages: 4,
		growthMs: 170_000,
		waterBoostMs: 26_000,
		maxWater: 5,
		tint: 0x7a52a8
	},
	{
		id: 'pumpkin',
		label: 'Pumpkin',
		row: 9,
		stages: 4,
		growthMs: 210_000,
		waterBoostMs: 30_000,
		maxWater: 6,
		tint: 0xe08a3a
	}
];

export const CROP_BY_ID: Record<string, CropDef> = Object.fromEntries(
	CROPS.map((crop) => [crop.id, crop])
);

export const WATER_COOLDOWN_MS = 7_000; // min gap between waterings that count
export const WATER_VISIBLE_MS = 28_000; // soil renders "wet" for this long

function ripeAt(crop: CropDef, plot: FarmPlotSyncState) {
	const planted = plot.plantedAt ?? 0;
	const water = Math.min(plot.waterCount ?? 0, crop.maxWater);
	return planted + crop.growthMs - water * crop.waterBoostMs;
}

/** 0..1 growth progress for a planted plot. */
export function cropProgress(plot: FarmPlotSyncState, now: number): number {
	if (plot.state !== 'planted' || !plot.crop) {
		return 0;
	}
	const crop = CROP_BY_ID[plot.crop];
	if (!crop) {
		return 0;
	}
	const planted = plot.plantedAt ?? 0;
	const ripe = ripeAt(crop, plot);
	const span = Math.max(1, ripe - planted);
	return Math.min(1, Math.max(0, (now - planted) / span));
}

/** Visible growth-stage index 0..stages-1. */
export function cropStage(plot: FarmPlotSyncState, now: number): number {
	if (plot.state !== 'planted' || !plot.crop) {
		return 0;
	}
	const crop = CROP_BY_ID[plot.crop];
	if (!crop) {
		return 0;
	}
	const progress = cropProgress(plot, now);
	return Math.min(crop.stages - 1, Math.floor(progress * crop.stages));
}

export function cropRipe(plot: FarmPlotSyncState, now: number): boolean {
	if (plot.state !== 'planted' || !plot.crop) {
		return false;
	}
	return cropProgress(plot, now) >= 1;
}

/** A planted, unripe plot that hasn't been watered recently wants water. */
export function plotNeedsWater(plot: FarmPlotSyncState, now: number): boolean {
	if (plot.state !== 'planted' || !plot.crop || cropRipe(plot, now)) {
		return false;
	}
	const wateredAt = plot.wateredAt ?? 0;
	return now - wateredAt > WATER_VISIBLE_MS;
}

export function plotIsWet(plot: FarmPlotSyncState, now: number): boolean {
	const wateredAt = plot.wateredAt ?? 0;
	return wateredAt > 0 && now - wateredAt < WATER_VISIBLE_MS;
}

export function canWater(plot: FarmPlotSyncState, now: number): boolean {
	if (plot.state !== 'planted' || !plot.crop || cropRipe(plot, now)) {
		return false;
	}
	const crop = CROP_BY_ID[plot.crop];
	if (!crop || (plot.waterCount ?? 0) >= crop.maxWater) {
		return false;
	}
	const wateredAt = plot.wateredAt ?? 0;
	return now - wateredAt > WATER_COOLDOWN_MS;
}
