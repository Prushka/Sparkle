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
	showTriggerTooltip?: boolean;
	triggerClassName?: string;
	onOpenChange?: (open: boolean) => void;
	onPlay: (effect: SoundEffect) => void;
};

export function SoundEffectPicker({
	disabled = false,
	showTriggerTooltip = true,
	triggerClassName = '',
	onOpenChange,
	onPlay
}: Props) {
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
	const trigger = (
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
	);

	return (
		<Popover.Root
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				onOpenChange?.(nextOpen);
			}}
		>
			{showTriggerTooltip ? (
				<Tooltip.Provider delayDuration={0}>
					<Tooltip.Root>
						<Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
						<Tooltip.Content>
							<p>Browse sound effects</p>
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			) : (
				trigger
			)}
			<Popover.Content
				align="start"
				side="top"
				sideOffset={8}
				className="w-[min(32rem,calc(100vw-1.25rem))] overflow-hidden rounded-lg border border-white/15 bg-background/45 p-0 shadow-2xl"
			>
				<div className="border-b border-white/10 bg-black/15 p-2">
					<div className="flex h-11 items-center rounded-md border border-white/15 bg-black/20 px-3 ring-offset-background focus-within:border-primary/80 focus-within:ring-2 focus-within:ring-primary/45 focus-within:ring-offset-0">
						<IconSearch size={18} stroke={2} className="shrink-0 text-muted-foreground" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
							placeholder="Find the perfect sound"
						/>
					</div>
				</div>
				<div className="max-h-[22rem] overflow-y-auto px-2 pb-2">
					{showEmptyState ? (
						<div className="mt-2 rounded-md border border-dashed border-white/10 px-3 py-8 text-center text-xs text-muted-foreground">
							No sounds found
						</div>
					) : (
						<div className="space-y-3">
							{soundSections.map((section, sectionIndex) => (
								<motion.section
									key={section.id}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.16, delay: sectionIndex * 0.025, ease: 'easeOut' }}
								>
									<div
										data-category-header={section.label}
										data-sticky-category={section.label}
										className="sticky top-0 z-20 -mx-2 mb-1.5 flex h-7 items-center border-b border-white/10 bg-background/55 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground shadow-sm"
									>
										{section.label}
									</div>
									<div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
										{section.items.map((effect) => (
											<motion.button
												key={effect.id}
												type="button"
												className="group flex min-h-10 min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-muted/25 px-2.5 py-1.5 text-left transition-colors hover:border-primary/35 hover:bg-accent/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
												aria-label={`Play ${effect.name}`}
												whileHover={{ y: -1, scale: 1.015 }}
												whileTap={{ scale: 0.98 }}
												transition={{ duration: 0.12, ease: 'easeOut' }}
												onClick={() => onPlay(effect)}
											>
												<span className="shrink-0 text-lg leading-none transition-transform duration-150 group-hover:scale-110">
													{effect.icon}
												</span>
												<span className="min-w-0 flex-1 truncate text-xs font-medium leading-tight">
													{effect.name}
												</span>
											</motion.button>
										))}
									</div>
								</motion.section>
							))}
						</div>
					)}
				</div>
			</Popover.Content>
		</Popover.Root>
	);
}
