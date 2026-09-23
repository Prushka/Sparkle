'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Menu, useMediaPlayer } from '@vidstack/react';
import {
	DefaultMenuButton,
	DefaultMenuRadioGroup,
	DefaultMenuSection,
	DefaultTooltip,
	defaultLayoutIcons
} from '@vidstack/react/player/layouts/default';
import { RAW_STATUS_EVENT, RawProvider } from '@/lib/player/raw-provider';
import type { RawMedia, RawPlaybackStatus } from '@/lib/player/raw-types';
import type { HDRPreference } from '@/lib/player/raw-types';

function useRawPlayback(onTracks?: (status: RawPlaybackStatus) => void) {
	const player = useMediaPlayer();
	const subscribe = useCallback(
		(update: () => void) => {
			player?.addEventListener(RAW_STATUS_EVENT as any, update);
			player?.addEventListener('provider-change', update);
			return () => {
				player?.removeEventListener(RAW_STATUS_EVENT as any, update);
				player?.removeEventListener('provider-change', update);
			};
		},
		[player]
	);
	const snapshot = useCallback(() => {
		const provider = player?.provider;
		return provider instanceof RawProvider ? provider.status : undefined;
	}, [player]);
	// Vidstack measures lazily mounted menus during their first render. Reading
	// the current snapshot synchronously avoids inserting a clipped entry later.
	const status = useSyncExternalStore(subscribe, snapshot, () => undefined);
	useEffect(() => {
		if (status) onTracks?.(status);
	}, [status, onTracks]);
	const provider = player?.provider;
	return { status, provider: provider instanceof RawProvider ? provider : undefined, player };
}

// Reporting stays mounted while Vidstack lazily mounts closed menus.
export function RawPlaybackObserver({
	onTracks
}: {
	onTracks: (status: RawPlaybackStatus) => void;
}) {
	const { status, player, provider } = useRawPlayback(onTracks);
	useEffect(() => {
		const el = player?.el;
		if (!el || !provider) return;
		const keydown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (
				event.key.toLowerCase() !== 'c' ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			void provider.toggleSubtitles().catch(() => {});
		};
		el.addEventListener('keydown', keydown, true);
		return () => el.removeEventListener('keydown', keydown, true);
	}, [player, provider]);
	useEffect(() => {
		if (!player?.el || !status) return;
		player.el.dataset.rawReady = String(status.ready);
		player.el.dataset.rawOutput = status.output;
		player.el.dataset.rawHdr = status.sourceHDR;
		player.el.dataset.rawRenderer = status.renderer ?? '';
		player.el.dataset.rawBlocked = String(
			!status.changing && !status.ready && status.output === 'unsupported'
		);
	}, [player, status]);
	return status?.reason && !status.changing && status.output === 'unsupported' ? (
		<div
			className="pointer-events-none absolute inset-x-6 top-6 z-20 mx-auto max-w-xl rounded-xl bg-black/85 p-4 text-sm text-white"
			role="status"
		>
			<p className="font-semibold">Playback unavailable on this device</p>
			<p className="mt-1">{status.reason}</p>
			<p className="mt-2 text-white/70">
				Open Settings → Video Settings for playback options. You can still use the room and chat.
			</p>
		</div>
	) : null;
}

export function RawCaptionButton() {
	const { status, provider } = useRawPlayback();
	if (!status?.subtitleTracks.length) return null;
	const enabled = (status.subtitle ?? -1) >= 0 || status.subtitleLayers?.some((id) => id >= 0);
	const Icon = enabled ? defaultLayoutIcons.CaptionButton.On : defaultLayoutIcons.CaptionButton.Off;
	return (
		<DefaultTooltip content={enabled ? 'Disable captions' : 'Enable captions'} placement="top">
			<button
				type="button"
				className="vds-button sparkle-raw-caption-button"
				aria-label="Closed captions"
				aria-pressed={!!enabled}
				aria-keyshortcuts="c"
				disabled={!status.ready || status.changing}
				onClick={() => void provider?.toggleSubtitles().catch(() => {})}
			>
				<Icon className="vds-icon" />
			</button>
		</DefaultTooltip>
	);
}

export function RawCastButton() {
	return (
		<Menu.Root className="vds-menu">
			<DefaultTooltip content="Google Cast options" placement="top">
				<Menu.Button className="vds-button" aria-label="Google Cast options">
					<defaultLayoutIcons.GoogleCastButton.Default className="vds-icon" />
				</Menu.Button>
			</DefaultTooltip>
			<Menu.Items className="vds-menu-items max-w-72" placement="top end" offset={26}>
				<div className="p-3 text-sm leading-relaxed" role="note">
					<p className="font-semibold">Direct casting unavailable</p>
					<p className="mt-2">
						Raw playback is decoded in this browser. To share it with a Cast device, use Chrome’s
						menu → Cast → Sources → Cast tab, or choose a compatible processed version.
					</p>
				</div>
			</Menu.Items>
		</Menu.Root>
	);
}

export function RawVideoSettings({
	raw,
	mediaId,
	onVersion
}: {
	raw: RawMedia;
	mediaId: string;
	onVersion: (id: string) => void;
}) {
	const { status, provider } = useRawPlayback();
	const audio = status?.audioTracks.find((t) => t.id === status.audio)?.title ?? 'Default';
	const output =
		status?.output === 'Native dynamic HDR (unverified)'
			? 'Native HDR'
			: status?.output === 'SDR tone mapping'
				? 'SDR · tone mapped'
				: status?.output === 'unsupported'
					? 'Unavailable'
					: (status?.output ?? 'Checking…');
	return (
		<Menu.Root className="vds-player-settings-menu vds-video-settings-menu vds-menu">
			<DefaultMenuButton
				label="Video Settings"
				hint={output}
				Icon={defaultLayoutIcons.Menu.Settings}
			/>
			<Menu.Items className="vds-menu-items">
				{status?.audioTracks.length ? (
					<DefaultMenuSection label="Audio Track" value={audio}>
						<DefaultMenuRadioGroup
							value={String(status.audio ?? '')}
							options={status.audioTracks.map((t) => ({ value: String(t.id), label: t.title }))}
							onChange={(value) =>
								void provider?.selectTrack('audio', Number(value)).catch(() => {})
							}
						/>
					</DefaultMenuSection>
				) : null}
				<DefaultMenuSection label="HDR output" value={output}>
					{status?.sourceHDR !== 'SDR' && (
						<DefaultMenuRadioGroup
							value={status?.hdrPreference ?? 'auto'}
							options={[
								{ value: 'auto', label: 'Automatic' },
								...(provider?.compatibleHDR
									? [{ value: 'compatible', label: `Compatible ${provider.compatibleHDR}` }]
									: []),
								{ value: 'sdr', label: 'SDR tone mapping' }
							]}
							onChange={(value) => void provider?.chooseHDR(value as HDRPreference).catch(() => {})}
						/>
					)}
					<div className="sparkle-hdr-status px-3 py-3 text-xs leading-relaxed" data-raw-hdr-status>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
							<dt className="text-white/55">Source</dt>
							<dd className="m-0 text-right text-white/90">
								{status?.sourceHDR
									.replaceAll('Dolby Vision Profile ', 'Dolby Vision P')
									.replaceAll(' / ', ' · ') ?? 'Loading…'}
							</dd>
							<dt className="text-white/55">Output</dt>
							<dd className="m-0 text-right font-medium text-white">{output}</dd>
							<dt className="text-white/55">Renderer</dt>
							<dd className="m-0 text-right text-white/90">
								{status?.renderer === 'native'
									? 'Native video'
									: status?.renderer === 'software'
										? 'Client tone mapper'
										: status?.ready
											? 'Client player'
											: 'Checking…'}
							</dd>
						</dl>
						{status?.reason && (
							<p className="mt-3 border-t border-white/10 pt-2 text-white/60">{status.reason}</p>
						)}
					</div>
					{status?.output === 'unsupported' && provider?.compatibleHDR && (
						<button
							type="button"
							role="menuitem"
							className="vds-menu-item"
							onClick={() => void provider.chooseCompatibleHDR().catch(() => {})}
						>
							Try compatible {provider.compatibleHDR} playback
						</button>
					)}
				</DefaultMenuSection>
				{raw.versions.length > 1 && (
					<DefaultMenuSection label="Shared media version" value="Applies to the room">
						<DefaultMenuRadioGroup
							value={mediaId}
							options={raw.versions.map((v) => ({ value: v.id, label: v.label }))}
							onChange={onVersion}
						/>
					</DefaultMenuSection>
				)}
			</Menu.Items>
		</Menu.Root>
	);
}

export function RawSubtitleSettings() {
	const { status, provider } = useRawPlayback();
	const tracks = status?.subtitleTracks ?? [];
	if (!tracks.length) return null;
	const selected = tracks.find((t) => t.id === status?.subtitle)?.title ?? 'Off';
	const options = [
		{ value: '-1', label: 'Off' },
		...tracks.map((t) => ({ value: String(t.id), label: t.title }))
	];
	return (
		<Menu.Root className="vds-player-settings-menu vds-subtitles-settings-menu vds-menu">
			<DefaultMenuButton
				label="Subtitles"
				hint={selected}
				Icon={defaultLayoutIcons.Menu.Captions}
			/>
			<Menu.Items className="vds-menu-items">
				<DefaultMenuSection label="Primary subtitles" value={selected}>
					<DefaultMenuRadioGroup
						value={String(status?.subtitle ?? -1)}
						options={options}
						onChange={(value) =>
							void provider?.selectTrack('subtitle', Number(value)).catch(() => {})
						}
					/>
				</DefaultMenuSection>
				{tracks.length > 1 &&
					[0, 1].map((layer) => (
						<DefaultMenuSection key={layer} label={`Subtitle layer ${layer + 2}`}>
							<DefaultMenuRadioGroup
								value={String(status?.subtitleLayers?.[layer] ?? -1)}
								options={options.filter(
									(t) =>
										t.value === '-1' ||
										(Number(t.value) !== status?.subtitle &&
											!(status?.subtitleLayers ?? []).some(
												(id, i) => i !== layer && id === Number(t.value)
											))
								)}
								onChange={(value) => {
									const ids = [...(status?.subtitleLayers ?? [])];
									ids[layer] = Number(value);
									void provider?.selectSubtitleLayers(ids).catch(() => {});
								}}
							/>
						</DefaultMenuSection>
					))}
				<p className="px-3 py-2 text-xs opacity-70">Audio and subtitles change only for you.</p>
			</Menu.Items>
		</Menu.Root>
	);
}
