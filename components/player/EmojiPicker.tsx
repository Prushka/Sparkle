'use client';

/* eslint-disable @next/next/no-img-element -- Emotes can be animated third-party images. */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { IconMoodSmile, IconSearch } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import * as Popover from '@/components/ui/popover';
import * as Tooltip from '@/components/ui/tooltip';
import {
	chatEmojis,
	emojiCategories,
	searchChatEmojis,
	type ChatEmojiRef,
	type ChatEmojiCategory
} from '@/lib/player/emoji';

type Props = {
	disabled?: boolean;
	triggerClassName?: string;
	onSelect: (emoji: ChatEmojiRef) => void;
};

type EmojiSection = {
	id: ChatEmojiCategory | 'gifs';
	label: string;
	items: ChatEmojiRef[];
};

export function EmojiPicker({ disabled = false, triggerClassName = '', onSelect }: Props) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [tenorResults, setTenorResults] = useState<ChatEmojiRef[]>([]);
	const [tenorLoading, setTenorLoading] = useState(false);
	const [tenorError, setTenorError] = useState('');

	const emojiSections = useMemo<EmojiSection[]>(() => {
		const normalizedQuery = query.trim();
		const searchedEmoji = normalizedQuery ? searchChatEmojis(normalizedQuery, 80) : chatEmojis;
		const sections: EmojiSection[] = [];

		if (tenorResults.length || tenorLoading || tenorError) {
			sections.push({
				id: 'gifs',
				label: normalizedQuery ? 'Live GIFs' : 'Featured GIFs',
				items: tenorResults
			});
		}

		for (const category of emojiCategories) {
			const items = searchedEmoji.filter((emoji) => emoji.category === category.id);
			if (items.length) {
				sections.push({
					id: category.id,
					label: category.label,
					items
				});
			}
		}

		return sections;
	}, [query, tenorError, tenorLoading, tenorResults]);

	const showEmptyState =
		!tenorLoading && !tenorError && emojiSections.every((section) => section.items.length === 0);

	useEffect(() => {
		if (!open) {
			return;
		}

		const controller = new AbortController();
		const timeout = window.setTimeout(() => {
			setTenorLoading(true);
			setTenorError('');
			const params = new URLSearchParams({ limit: query.trim() ? '24' : '12' });
			if (query.trim()) {
				params.set('q', query.trim());
			}
			fetch(`/api/tenor?${params.toString()}`, { signal: controller.signal })
				.then((response) => response.json())
				.then((payload: { results?: ChatEmojiRef[]; error?: string }) => {
					if (controller.signal.aborted) {
						return;
					}
					setTenorResults(payload.results ?? []);
					setTenorError(payload.error ? 'GIF search unavailable' : '');
				})
				.catch((error: Error) => {
					if (!controller.signal.aborted) {
						setTenorError(error.message ? 'GIF search unavailable' : 'GIF search failed');
						setTenorResults([]);
					}
				})
				.finally(() => {
					if (!controller.signal.aborted) {
						setTenorLoading(false);
					}
				});
		}, 250);

		return () => {
			controller.abort();
			window.clearTimeout(timeout);
		};
	}, [open, query]);

	function selectEmoji(emoji: ChatEmojiRef) {
		onSelect(emoji);
		setOpen(false);
	}

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
								aria-label="Browse emoji"
							>
								<IconMoodSmile size={18} stroke={2} />
							</Button>
						</Popover.Trigger>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>Browse emoji</p>
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
							placeholder="Search emoji and GIFs"
						/>
					</div>
				</div>
				<div className="max-h-[22rem] space-y-3 overflow-y-auto p-2">
					{emojiSections.map((section, sectionIndex) => (
						<motion.section
							key={section.id}
							initial={{ opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.16, delay: sectionIndex * 0.025, ease: 'easeOut' }}
						>
							<div className="mb-1.5 px-1">
								<h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
									{section.label}
								</h3>
							</div>
							{section.items.length ? (
								<div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
									{section.items.map((emoji) => (
										<Tooltip.Provider key={emoji.id} delayDuration={150}>
											<Tooltip.Root>
												<Tooltip.Trigger asChild>
													<motion.button
														type="button"
														aria-label={`:${emoji.id}:`}
														className="group flex aspect-square items-center justify-center rounded-md border border-transparent bg-muted/35 p-0.5 transition-colors hover:border-primary/35 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
														whileHover={{ y: -1, scale: 1.04 }}
														whileTap={{ scale: 0.96 }}
														transition={{ duration: 0.12, ease: 'easeOut' }}
														onClick={() => selectEmoji(emoji)}
													>
														<img
															src={emoji.src}
															alt=""
															loading="lazy"
															decoding="async"
															className="h-full max-h-5 w-full object-contain transition-transform duration-150 group-hover:scale-110"
														/>
													</motion.button>
												</Tooltip.Trigger>
												<Tooltip.Content side="bottom">
													<p>{`:${emoji.id}:`}</p>
												</Tooltip.Content>
											</Tooltip.Root>
										</Tooltip.Provider>
									))}
								</div>
							) : (
								<div className="rounded-md border border-dashed border-white/10 px-3 py-5 text-center text-xs text-muted-foreground">
									{tenorLoading ? 'Loading GIFs' : tenorError}
								</div>
							)}
						</motion.section>
					))}
					{showEmptyState ? (
						<div className="rounded-md border border-dashed border-white/10 px-3 py-8 text-center text-xs text-muted-foreground">
							No emoji found
						</div>
					) : null}
				</div>
			</Popover.Content>
		</Popover.Root>
	);
}
