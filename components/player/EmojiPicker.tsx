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
	triggerClassName?: string;
	onSelect: (emoji: ChatEmojiRef) => void;
};

type EmojiSection = {
	id: ChatEmojiCategory;
	label: string;
	items: ChatEmojiRef[];
};

type EmojiVirtualRow =
	| {
			key: string;
			type: 'header';
			label: string;
			height: number;
	  }
	| {
			key: string;
			type: 'items';
			items: ChatEmojiRef[];
			height: number;
	  };

type EmojiVirtualLayout = {
	row: EmojiVirtualRow;
	top: number;
};

const emojiGridGap = 4;
const emojiHeaderHeight = 26;
const emojiRowGap = 8;
const emojiOverscanPx = 240;
const emojiPanelHeight = 352;

export function EmojiPicker({ disabled = false, triggerClassName = '', onSelect }: Props) {
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

	const { totalHeight, rowLayouts } = useMemo(() => {
		const rows: EmojiVirtualLayout[] = [];
		let top = 0;

		for (const section of emojiSections) {
			const header: EmojiVirtualRow = {
				key: `${section.id}-header`,
				type: 'header',
				label: section.label,
				height: emojiHeaderHeight
			};
			rows.push({ row: header, top });
			top += header.height;

			for (let index = 0; index < section.items.length; index += columns) {
				const itemRow: EmojiVirtualRow = {
					key: `${section.id}-${index}`,
					type: 'items',
					items: section.items.slice(index, index + columns),
					height: tileSize
				};
				rows.push({ row: itemRow, top });
				top += itemRow.height;
			}

			top += emojiRowGap;
		}

		return { totalHeight: top, rowLayouts: rows };
	}, [columns, emojiSections, tileSize]);

	const visibleRows = useMemo(() => {
		const min = Math.max(0, scrollTop - emojiOverscanPx);
		const max = scrollTop + viewportHeight + emojiOverscanPx;
		return rowLayouts.filter(({ row, top: rowTop }) => rowTop + row.height >= min && rowTop <= max);
	}, [rowLayouts, scrollTop, viewportHeight]);

	const showEmptyState = emojiSections.every((section) => section.items.length === 0);

	function selectEmoji(emoji: ChatEmojiRef) {
		onSelect(emoji);
		setOpen(false);
	}

	function resetScroll() {
		setScrollTop(0);
		scrollRef.current?.scrollTo({ top: 0 });
	}

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen) {
			resetScroll();
		}
	}

	function handleQueryChange(value: string) {
		setQuery(value);
		resetScroll();
	}

	return (
		<Tooltip.Provider delayDuration={0}>
			<Popover.Root open={open} onOpenChange={handleOpenChange}>
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
								onChange={(event) => handleQueryChange(event.target.value)}
								className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
								placeholder="Search emoji"
							/>
						</div>
					</div>
					<div
						ref={scrollRef}
						className="overflow-y-auto p-2"
						style={{ height: emojiPanelHeight }}
						onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
					>
						{showEmptyState ? (
							<div className="rounded-md border border-dashed border-white/10 px-3 py-8 text-center text-xs text-muted-foreground">
								No emoji found
							</div>
						) : (
							<div className="relative" style={{ height: totalHeight }}>
								{visibleRows.map(({ row, top }) => (
									<div
										key={row.key}
										className="absolute left-0 right-0"
										style={{ height: row.height, transform: `translateY(${top}px)` }}
									>
										{row.type === 'header' ? (
											<div className="flex h-full items-end px-1 pb-1.5">
												<h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
													{row.label}
												</h3>
											</div>
										) : (
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
																className="flex aspect-square items-center justify-center rounded-md border border-transparent bg-muted/35 p-0.5 hover:border-primary/35 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
										)}
									</div>
								))}
							</div>
						)}
					</div>
				</Popover.Content>
			</Popover.Root>
		</Tooltip.Provider>
	);
}
