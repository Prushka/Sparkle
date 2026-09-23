'use client';
import { useEffect, useState } from 'react';
import { Menu, useMediaPlayer } from '@vidstack/react';
import {
	DefaultMenuButton,
	DefaultMenuRadioGroup,
	DefaultMenuSection,
	defaultLayoutIcons
} from '@vidstack/react/player/layouts/default';
import { RAW_STATUS_EVENT, RawProvider } from '@/lib/player/raw-provider';
import type { RawMedia, RawPlaybackStatus } from '@/lib/player/raw-types';

function useRawPlayback(onTracks?: (status: RawPlaybackStatus) => void) {
	const player = useMediaPlayer();
	const [status, setStatus] = useState<RawPlaybackStatus>();
	useEffect(() => {
		const el = player?.el;
		if (!el) return;
		const update = (next: RawPlaybackStatus) => {
			setStatus(next);
			onTracks?.(next);
		};
		const provider = player.provider;
		if (provider instanceof RawProvider) update(provider.status);
		const listener = (event: Event) => update((event as CustomEvent<RawPlaybackStatus>).detail);
		el.addEventListener(RAW_STATUS_EVENT, listener);
		return () => el.removeEventListener(RAW_STATUS_EVENT, listener);
	}, [player, onTracks]);
	const provider = player?.provider;
	return { status, provider: provider instanceof RawProvider ? provider : undefined, player };
}

// Reporting stays mounted while Vidstack lazily mounts closed menus.
export function RawPlaybackObserver({
	onTracks
}: {
	onTracks: (status: RawPlaybackStatus) => void;
}) {
	const { status, player } = useRawPlayback(onTracks);
	useEffect(() => {
		if (!player?.el || !status) return;
		player.el.dataset.rawReady = String(status.ready);
		player.el.dataset.rawOutput = status.output;
		player.el.dataset.rawHdr = status.sourceHDR;
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
	return (
		<Menu.Root className="vds-player-settings-menu vds-video-settings-menu vds-menu">
			<DefaultMenuButton
				label="Video Settings"
				hint={status?.output ?? 'Loading…'}
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
				<DefaultMenuSection label="HDR output" value={status?.output ?? 'Checking playback'}>
					<div className="px-3 py-2 text-sm leading-relaxed" data-raw-hdr-status>
						<p>
							Raw · {status?.sourceHDR ?? 'Loading…'} → {status?.output ?? 'Checking playback'}
						</p>
						{status?.reason && <p className="mt-2 opacity-75">{status.reason}</p>}
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
