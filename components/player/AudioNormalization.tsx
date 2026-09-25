'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMediaPlayer } from '@vidstack/react';
import { DefaultTooltip } from '@vidstack/react/player/layouts/default';
import { IconWaveSine } from '@tabler/icons-react';
import {
	readNormalization,
	saveNormalization,
	subscribeNormalization,
	type NormalizationStatus
} from '@/lib/player/audio-normalization';

export function AudioNormalizationButton() {
	const player = useMediaPlayer();
	const enabled = useSyncExternalStore(subscribeNormalization, readNormalization, () => false);
	const [state, setState] = useState<NormalizationStatus['state']>('off');
	useEffect(() => {
		if (!player?.el) return;
		const el = player.el;
		const update = () =>
			setState((el.dataset.normalizationState as NormalizationStatus['state']) || 'off');
		el.addEventListener('sparkle-normalization-status', update);
		update();
		return () => el.removeEventListener('sparkle-normalization-status', update);
	}, [player]);
	const label = !enabled
		? 'Normalize audio'
		: state === 'unavailable'
			? 'Normalization unavailable · original audio'
			: state === 'loading'
				? 'Loading audio normalization…'
				: 'Disable audio normalization';
	return (
		<DefaultTooltip content={label} placement="top">
			<button
				type="button"
				className="vds-button sparkle-normalization-button"
				aria-label="Normalize audio"
				aria-pressed={enabled}
				title={label}
				data-active={enabled && state !== 'unavailable' ? '' : undefined}
				onClick={() => saveNormalization(!enabled)}
			>
				<IconWaveSine className="vds-icon" style={{ opacity: enabled ? 1 : 0.6 }} />
			</button>
		</DefaultTooltip>
	);
}
