'use client';

/* eslint-disable @next/next/no-img-element -- Emotes can be animated images. */

import { useEffect, useMemo, useRef, useState } from 'react';
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
	showTriggerTooltip?: boolean;
	triggerClassName?: string;
	onOpenChange?: (open: boolean) => void;
	onSelect: (emoji: ChatEmojiRef) => void;
};

type EmojiSection = {
	id: ChatEmojiCategory;
	label: string;
	items: ChatEmojiRef[];
};

type EmojiVirtualItemRow = {
	key: string;
	items: ChatEmojiRef[];
	top: number;
	height: number;
};

type EmojiVirtualSectionLayout = {
	id: ChatEmojiCategory;
	label: string;
	itemAreaTop: number;
	itemAreaHeight: number;
	rows: EmojiVirtualItemRow[];
};

const emojiGridGap = 4;
const emojiHeaderHeight = 28;
const emojiRowGap = 8;
const emojiOverscanPx = 240;
const emojiPanelHeight = 352;

export function EmojiPicker({
	disabled = false,
	showTriggerTooltip = true,
	triggerClassName = '',
	onOpenChange,
	onSelect
}: Props) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(emojiPanelHeight);
	const [viewportWidth, setViewportWidth] = useState(480);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open || !scrollRef.current) {
			return;
		}

		const element = scrollRef.current;
		const updateSize = () => {
			setViewportHeight(element.clientHeight || emojiPanelHeight);
			setViewportWidth(element.clientWidth || 480);
		};
		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(element);
		return () => observer.disconnect();
	}, [open]);

	const emojiSections = useMemo<EmojiSection[]>(() => {
		const normalizedQuery = query.trim();
		const searchedEmoji = normalizedQuery ? searchChatEmojis(normalizedQuery, 160) : chatEmojis;
		const sections: EmojiSection[] = [];

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
	}, [query]);

	const columns = viewportWidth >= 420 ? 10 : 8;
	const tileSize = Math.max(
		28,
		Math.floor((Math.max(viewportWidth, 320) - emojiGridGap * (columns - 1)) / columns)
	);

	const sectionLayouts = useMemo<EmojiVirtualSectionLayout[]>(() => {
		const sections: EmojiVirtualSectionLayout[] = [];
		let top = 0;

		for (const section of emojiSections) {
			const rows: EmojiVirtualItemRow[] = [];
			let itemTop = 0;

			for (let index = 0; index < section.items.length; index += columns) {
				rows.push({
					key: `${section.id}-${index}`,
					items: section.items.slice(index, index + columns),
					top: itemTop,
					height: tileSize
				});
				itemTop += tileSize;
			}

			sections.push({
				id: section.id,
				label: section.label,
				itemAreaTop: top + emojiHeaderHeight,
				itemAreaHeight: itemTop,
				rows
			});
			top += emojiHeaderHeight + itemTop + emojiRowGap;
		}

		return sections;
	}, [columns, emojiSections, tileSize]);

	const visibleSectionLayouts = useMemo(() => {
		const min = Math.max(0, scrollTop - emojiOverscanPx);
		const max = scrollTop + viewportHeight + emojiOverscanPx;
		return sectionLayouts.map((section) => ({
			...section,
			visibleRows: section.rows.filter((row) => {
				const rowTop = section.itemAreaTop + row.top;
				return rowTop + row.height >= min && rowTop <= max;
			})
		}));
	}, [scrollTop, sectionLayouts, viewportHeight]);

	const showEmptyState = emojiSections.every((section) => section.items.length === 0);

	function selectEmoji(emoji: ChatEmojiRef) {
		onSelect(emoji);
		handleOpenChange(false);
	}

	function resetScroll() {
		setScrollTop(0);
		scrollRef.current?.scrollTo({ top: 0 });
	}

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen);
		onOpenChange?.(nextOpen);
		if (nextOpen) {
			resetScroll();
		}
	}

	function handleQueryChange(value: string) {
		setQuery(value);
		resetScroll();
	}

	const trigger = (
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
	);

	return (
		<Tooltip.Provider delayDuration={0}>
			<Popover.Root open={open} onOpenChange={handleOpenChange}>
				{showTriggerTooltip ? (
					<Tooltip.Root>
						<Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
						<Tooltip.Content>
							<p>Browse emoji</p>
						</Tooltip.Content>
					</Tooltip.Root>
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
								onChange={(event) => handleQueryChange(event.target.value)}
								className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
								placeholder="Search emoji"
							/>
						</div>
					</div>
					<div
						ref={scrollRef}
						className="overflow-y-auto px-2 pb-2"
						style={{ height: emojiPanelHeight }}
						onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
					>
						{showEmptyState ? (
							<div className="rounded-md border border-dashed border-white/10 px-3 py-8 text-center text-xs text-muted-foreground">
								No emoji found
							</div>
						) : (
							<div>
								{visibleSectionLayouts.map((section) => (
									<section
										key={section.id}
										className="relative"
										style={{ paddingBottom: emojiRowGap }}
									>
										<div
											data-category-header={section.label}
											className="sticky top-0 z-20 -mx-2 flex h-7 items-center border-b border-white/10 bg-background/55 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground shadow-sm"
										>
											{section.label}
										</div>
										<div className="relative" style={{ height: section.itemAreaHeight }}>
											{section.visibleRows.map((row) => (
												<div
													key={row.key}
													className="absolute left-0 right-0 top-0"
													style={{ height: row.height, transform: `translateY(${row.top}px)` }}
												>
													<div
														className="grid"
														style={{
															gap: emojiGridGap,
															gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
														}}
													>
														{row.items.map((emoji) => (
															<Tooltip.Root key={emoji.id}>
																<Tooltip.Trigger asChild>
																	<button
																		type="button"
																		aria-label={`:${emoji.id}:`}
																		className="flex aspect-square items-center justify-center rounded-md border border-transparent bg-muted/25 p-0.5 hover:border-primary/35 hover:bg-accent/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
																		onClick={() => selectEmoji(emoji)}
																	>
																		<img
																			src={emoji.src}
																			alt=""
																			loading="lazy"
																			decoding="async"
																			className="h-full max-h-5 w-full object-contain"
																		/>
																	</button>
																</Tooltip.Trigger>
																<Tooltip.Content side="bottom">
																	<p>{`:${emoji.id}:`}</p>
																</Tooltip.Content>
															</Tooltip.Root>
														))}
													</div>
												</div>
											))}
										</div>
									</section>
								))}
							</div>
						)}
					</div>
				</Popover.Content>
			</Popover.Root>
		</Tooltip.Provider>
	);
}
