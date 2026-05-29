'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { IconMusic, IconSearch } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Popover from '@/components/ui/popover';
import * as Tooltip from '@/components/ui/tooltip';
import {
	searchSoundEffects,
	soundEffectCategories,
	soundEffects,
	type SoundEffect
} from '@/lib/player/sound-effects';

type Props = {
	disabled?: boolean;
	triggerClassName?: string;
	onPlay: (effect: SoundEffect) => void;
};

export function SoundEffectPicker({ disabled = false, triggerClassName = '', onPlay }: Props) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');

	const soundSections = useMemo(() => {
		const normalizedQuery = query.trim();
		const searchedEffects = normalizedQuery
			? searchSoundEffects(normalizedQuery, 64)
			: soundEffects;
		return soundEffectCategories
			.map((category) => ({
				...category,
				items: searchedEffects.filter((effect) => effect.category === category.id)
			}))
			.filter((section) => section.items.length > 0);
	}, [query]);

	const showEmptyState = soundSections.length === 0;

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
				className="w-[min(32rem,calc(100vw-1.25rem))] overflow-hidden rounded-lg border border-white/10 bg-background/95 p-0 shadow-2xl backdrop-blur-md"
			>
				<div className="border-b border-white/10 bg-black/20 p-2">
					<div className="flex h-11 items-center rounded-md border border-white/15 bg-black/30 px-3 ring-offset-background focus-within:border-primary/80 focus-within:ring-2 focus-within:ring-primary/45 focus-within:ring-offset-0">
						<IconSearch size={18} stroke={2} className="shrink-0 text-muted-foreground" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
							placeholder="Find the perfect sound"
						/>
					</div>
				</div>
				<div className="max-h-[22rem] space-y-3 overflow-y-auto p-2">
					{soundSections.map((section, sectionIndex) => (
						<motion.section
							key={section.id}
							initial={{ opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.16, delay: sectionIndex * 0.025, ease: 'easeOut' }}
						>
							<div className="mb-1.5 flex items-center justify-between px-1">
								<h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
									{section.label}
								</h3>
								<span className="rounded-full bg-muted/45 px-2 py-0.5 text-[0.65rem] font-bold text-muted-foreground">
									{section.items.length}
								</span>
							</div>
							<div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
								{section.items.map((effect) => (
									<motion.button
										key={effect.id}
										type="button"
										className="group flex min-h-12 min-w-0 items-center gap-2 rounded-md border border-transparent bg-muted/35 px-3 py-2 text-left transition-colors hover:border-primary/35 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										aria-label={`Play ${effect.name}`}
										whileHover={{ y: -1, scale: 1.015 }}
										whileTap={{ scale: 0.98 }}
										transition={{ duration: 0.12, ease: 'easeOut' }}
										onClick={() => onPlay(effect)}
									>
										<span className="shrink-0 text-xl leading-none transition-transform duration-150 group-hover:scale-110">
											{effect.icon}
										</span>
										<span className="min-w-0 flex-1 truncate text-sm font-bold leading-tight">
											{effect.name}
										</span>
									</motion.button>
								))}
							</div>
						</motion.section>
					))}
					{showEmptyState ? (
						<div className="rounded-md border border-dashed border-white/10 px-3 py-8 text-center text-xs text-muted-foreground">
							No sounds found
						</div>
					) : null}
				</div>
			</Popover.Content>
		</Popover.Root>
	);
}
