'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
	DefaultMenuItem,
	DefaultMenuCheckbox,
	DefaultMenuSection
} from '@vidstack/react/player/layouts/default';
import { getSubtitleFormatName } from '@/lib/player/t';
import type { SubtitleTrackFormat } from '@/lib/player/track-selection';
import {
	type SubtitleTrackInfo,
	type SelectedSubtitleTrack,
	getAvailableSubtitleFormats,
	getSubtitleTracksByFormat
} from '@/lib/player/subtitle-selection';
function SubtitleLayerCheckbox({
	checked,
	disabled = false,
	label,
	onChange
}: {
	checked: boolean;
	disabled?: boolean;
	label: string;
	onChange: (checked: boolean, trigger?: Event) => void;
}) {
	const readyForTriggerlessChangesRef = useRef(false);

	useEffect(() => {
		readyForTriggerlessChangesRef.current = false;
		const timer = window.setTimeout(() => {
			readyForTriggerlessChangesRef.current = true;
		}, 0);
		return () => {
			window.clearTimeout(timer);
			readyForTriggerlessChangesRef.current = false;
		};
	}, []);

	const control = (
		<DefaultMenuItem label={label}>
			<DefaultMenuCheckbox
				label={label}
				checked={checked}
				onChange={(nextChecked, trigger) => {
					if (nextChecked === checked || (!trigger && !readyForTriggerlessChangesRef.current)) {
						return;
					}
					onChange(nextChecked, trigger);
				}}
			/>
		</DefaultMenuItem>
	);
	return disabled ? (
		<div inert aria-disabled="true" className="opacity-50">
			{control}
		</div>
	) : (
		control
	);
}

export function SubtitlesMenuSection({
	activeFormat,
	extraSubtitleLayerSrcs,
	onFormatChange,
	onToggleTrack,
	selectedTrack,
	tracks,
	maxLayers = Infinity
}: {
	activeFormat: SubtitleTrackFormat | null;
	extraSubtitleLayerSrcs: string[];
	onFormatChange: (format: SubtitleTrackFormat) => void;
	onToggleTrack: (track: SubtitleTrackInfo, checked: boolean) => void;
	selectedTrack: SelectedSubtitleTrack | null;
	tracks: SubtitleTrackInfo[];
	maxLayers?: number;
}) {
	const formats = getAvailableSubtitleFormats(tracks);
	const [preferredFormat, setPreferredFormat] = useState<SubtitleTrackFormat | null>(activeFormat);
	const displayedFormat =
		activeFormat ??
		(preferredFormat && formats.includes(preferredFormat) ? preferredFormat : formats[0]) ??
		null;
	const formatOptions = formats.map((format) => ({
		label: getSubtitleFormatName(format),
		value: format
	}));
	const formatTracks = getSubtitleTracksByFormat(tracks, displayedFormat);
	const selectedTrackSrcs = new Set([
		...(selectedTrack ? [selectedTrack.src] : []),
		...extraSubtitleLayerSrcs
	]);
	const formatToggleGroupRef = useRef<HTMLDivElement | null>(null);

	useLayoutEffect(() => {
		const group = formatToggleGroupRef.current;
		if (!group || typeof window === 'undefined') {
			return;
		}
		const menuRoot = group.closest<HTMLElement>('.vds-subtitles-settings-menu');
		const submenuItems = group.closest<HTMLElement>('.vds-menu-items[data-submenu]');
		const rootItems = group.closest<HTMLElement>('.vds-settings-menu-items[data-root]');

		const dispatchResize = () => {
			const targets = new Set<HTMLElement>([group]);
			if (submenuItems) {
				targets.add(submenuItems);
			}
			if (rootItems) {
				targets.add(rootItems);
			}
			for (const target of targets) {
				target.dispatchEvent(new Event('vds-menu-resize', { bubbles: true }));
			}
		};

		let firstFrame = 0;
		let secondFrame = 0;
		let thirdFrame = 0;
		let timeout = 0;

		const cancelScheduledRefresh = () => {
			window.cancelAnimationFrame(firstFrame);
			window.cancelAnimationFrame(secondFrame);
			window.cancelAnimationFrame(thirdFrame);
			window.clearTimeout(timeout);
			firstFrame = 0;
			secondFrame = 0;
			thirdFrame = 0;
			timeout = 0;
		};

		const refreshSubtitleMenuLayout = () => {
			cancelScheduledRefresh();
			dispatchResize();
			firstFrame = window.requestAnimationFrame(() => {
				dispatchResize();
				secondFrame = window.requestAnimationFrame(() => {
					dispatchResize();
					thirdFrame = window.requestAnimationFrame(dispatchResize);
				});
			});
			timeout = window.setTimeout(dispatchResize, 120);
		};

		refreshSubtitleMenuLayout();

		let resizeObserver: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => refreshSubtitleMenuLayout());
			resizeObserver.observe(submenuItems ?? group);
		}

		let mutationObserver: MutationObserver | null = null;
		if (typeof MutationObserver !== 'undefined') {
			mutationObserver = new MutationObserver(() => refreshSubtitleMenuLayout());
			for (const target of [menuRoot, submenuItems, rootItems]) {
				mutationObserver.observe(target ?? group, {
					attributeFilter: ['aria-hidden', 'class', 'data-open', 'hidden', 'style'],
					attributes: true
				});
			}
		}

		return () => {
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
			cancelScheduledRefresh();
		};
	}, [formatTracks.length]);

	if (formats.length === 0) {
		return null;
	}

	return (
		<>
			<DefaultMenuSection
				label="Format"
				value={displayedFormat ? getSubtitleFormatName(displayedFormat) : ''}
			>
				<div
					aria-label="Subtitle format"
					className="sparkle-subtitle-format-toggle-group"
					data-subtitle-format-toggle-group="true"
					ref={formatToggleGroupRef}
					role="radiogroup"
				>
					{formatOptions.map((option) => {
						const checked = displayedFormat === option.value;
						return (
							<button
								key={option.value}
								aria-checked={checked}
								className="sparkle-subtitle-format-toggle"
								onClick={() => {
									setPreferredFormat(option.value);
									onFormatChange(option.value);
								}}
								role="radio"
								type="button"
							>
								{option.label}
							</button>
						);
					})}
				</div>
			</DefaultMenuSection>
			{displayedFormat && formatTracks.length > 0 ? (
				<DefaultMenuSection label="Tracks" value={`${selectedTrackSrcs.size || 0}`}>
					{formatTracks.map((track) => (
						<SubtitleLayerCheckbox
							key={track.src}
							checked={selectedTrackSrcs.has(track.src)}
							disabled={
								!selectedTrackSrcs.has(track.src) &&
								selectedTrack?.format === track.format &&
								extraSubtitleLayerSrcs.length >= maxLayers
							}
							label={track.settingsLabel}
							onChange={(checked) => onToggleTrack(track, checked)}
						/>
					))}
					{Number.isFinite(maxLayers) && extraSubtitleLayerSrcs.length >= maxLayers ? (
						<p className="px-3 py-2 text-xs opacity-70">
							Up to {maxLayers + 1} subtitle tracks at once.
						</p>
					) : null}
				</DefaultMenuSection>
			) : null}
		</>
	);
}
