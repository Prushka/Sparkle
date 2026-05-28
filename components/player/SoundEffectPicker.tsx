'use client';

import { useMemo, useState } from 'react';
import { IconMusic, IconSearch } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Popover from '@/components/ui/popover';
import * as Tooltip from '@/components/ui/tooltip';
import {
	searchSoundEffects,
	soundEffectCategories,
	soundEffects,
	type SoundEffect,
	type SoundEffectCategory
} from '@/lib/player/sound-effects';

type Props = {
	disabled?: boolean;
	triggerClassName?: string;
	onPlay: (effect: SoundEffect) => void;
};

export function SoundEffectPicker({ disabled = false, triggerClassName = '', onPlay }: Props) {
	const [open, setOpen] = useState(false);
	const [category, setCategory] = useState<SoundEffectCategory>('reactions');
	const [query, setQuery] = useState('');

	const visibleEffects = useMemo(() => {
		if (query.trim()) {
			return searchSoundEffects(query, 32);
		}
		return soundEffects.filter((effect) => effect.category === category);
	}, [category, query]);

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Tooltip.Provider delayDuration={0}>
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<Popover.Trigger asChild>
							<Button
								disabled={disabled}
								variant="outline"
								className={triggerClassName}
								aria-label="Browse sound effects"
							>
								<IconMusic size={18} stroke={2} />
							</Button>
						</Popover.Trigger>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>Browse sound effects</p>
					</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Popover.Content
				align="start"
				side="top"
				sideOffset={8}
				className="w-[min(21rem,calc(100vw-1.25rem))] rounded-md border-white/15 bg-background/95 p-2 shadow-xl backdrop-blur-md"
			>
				<div className="grid grid-cols-4 gap-1">
					{soundEffectCategories.map((item) => (
						<button
							key={item.id}
							type="button"
							className={`rounded-md px-2 py-1.5 text-xs font-bold ${
								category === item.id && !query
									? 'bg-primary text-primary-foreground'
									: 'bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground'
							}`}
							onClick={() => {
								setCategory(item.id);
								setQuery('');
							}}
						>
							{item.label}
						</button>
					))}
				</div>
				<div className="mt-2 flex items-center rounded-md border bg-background px-2">
					<IconSearch size={15} stroke={2} className="shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
						placeholder="Search sounds"
					/>
				</div>
				<div className="mt-2 grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1">
					{visibleEffects.map((effect) => (
						<button
							key={effect.id}
							type="button"
							className="flex min-w-0 items-center gap-2 rounded-md border border-transparent bg-muted/45 px-2 py-1.5 text-left hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							aria-label={`Play ${effect.name}`}
							onClick={() => onPlay(effect)}
						>
							<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background/75 text-base">
								{effect.icon}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-xs font-bold leading-tight">
									{effect.name}
								</span>
								<span className="block text-[0.68rem] leading-tight text-muted-foreground">
									{effect.duration}
								</span>
							</span>
						</button>
					))}
				</div>
			</Popover.Content>
		</Popover.Root>
	);
}
