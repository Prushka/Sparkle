'use client';

/* eslint-disable @next/next/no-img-element -- Emotes can be animated third-party images. */

import { useEffect, useMemo, useState } from 'react';
import { IconMovie, IconMoodSmile, IconSparkles } from '@tabler/icons-react';
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

type PickerMode = 'gifs' | ChatEmojiCategory;

export function EmojiPicker({ disabled = false, triggerClassName = '', onSelect }: Props) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<PickerMode>('gifs');
	const [query, setQuery] = useState('');
	const [tenorResults, setTenorResults] = useState<ChatEmojiRef[]>([]);
	const [tenorLoading, setTenorLoading] = useState(false);
	const [tenorError, setTenorError] = useState('');

	const tabs = useMemo(() => [{ id: 'gifs' as const, label: 'GIFs' }, ...emojiCategories], []);
	const visibleEmoji: ChatEmojiRef[] = useMemo(() => {
		if (mode === 'gifs') {
			return tenorResults;
		}
		if (query.trim()) {
			return searchChatEmojis(query, 32);
		}
		return chatEmojis.filter((emoji) => emoji.category === mode);
	}, [mode, query, tenorResults]);

	useEffect(() => {
		if (!open || mode !== 'gifs') {
			return;
		}

		const controller = new AbortController();
		const timeout = window.setTimeout(() => {
			setTenorLoading(true);
			setTenorError('');
			const params = new URLSearchParams({ limit: '30' });
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
					setTenorError(payload.error ?? '');
				})
				.catch((error: Error) => {
					if (!controller.signal.aborted) {
						setTenorError(error.message || 'GIF search failed');
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
	}, [mode, open, query]);

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
				className="w-[min(19rem,calc(100vw-1.25rem))] rounded-md border-white/15 bg-background/95 p-2 shadow-xl backdrop-blur-md"
			>
				<div className="grid grid-cols-5 gap-1">
					{tabs.map((item) => (
						<button
							key={item.id}
							type="button"
							className={`rounded-md px-2 py-1.5 text-xs font-bold ${
								mode === item.id
									? 'bg-primary text-primary-foreground'
									: 'bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground'
							}`}
							onClick={() => {
								setMode(item.id);
								setQuery('');
							}}
						>
							{item.label}
						</button>
					))}
				</div>
				<div className="mt-2 flex items-center rounded-md border bg-background px-2">
					<IconSparkles size={15} stroke={2} className="shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
						placeholder={mode === 'gifs' ? 'Search GIFs' : 'Search'}
					/>
				</div>
				<div className="mt-2 grid max-h-60 grid-cols-7 gap-1 overflow-y-auto pr-1">
					{visibleEmoji.map((emoji) => (
						<Tooltip.Provider key={emoji.id} delayDuration={150}>
							<Tooltip.Root>
								<Tooltip.Trigger asChild>
									<button
										type="button"
										aria-label={`:${emoji.id}:`}
										className="group relative flex aspect-square items-center justify-center rounded-md border border-transparent bg-muted/45 p-0.5 hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										onClick={() => selectEmoji(emoji)}
									>
										<img
											src={emoji.src}
											alt=""
											loading="lazy"
											decoding="async"
											className="h-full max-h-7 w-full object-contain"
										/>
										{emoji.kind === 'sticker' || emoji.source === 'Tenor' ? (
											<IconMovie
												size={11}
												stroke={2}
												className="absolute bottom-0.5 right-0.5 rounded-sm bg-background/80 p-0.5 text-muted-foreground"
											/>
										) : null}
									</button>
								</Tooltip.Trigger>
								<Tooltip.Content side="bottom">
									<p>{`:${emoji.id}:`}</p>
								</Tooltip.Content>
							</Tooltip.Root>
						</Tooltip.Provider>
					))}
					{tenorLoading && mode === 'gifs' ? (
						<div className="col-span-7 px-2 py-6 text-center text-xs text-muted-foreground">
							Loading
						</div>
					) : null}
					{tenorError && mode === 'gifs' && !tenorLoading ? (
						<div className="col-span-7 px-2 py-6 text-center text-xs text-muted-foreground">
							{tenorError}
						</div>
					) : null}
				</div>
			</Popover.Content>
		</Popover.Root>
	);
}
