'use client';

/* eslint-disable @next/next/no-img-element -- Emotes can be animated third-party images. */

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { ChatEmojiRef } from '@/lib/player/emoji';

const emojiTokenRegex = /:([a-z0-9][a-z0-9_+-]{1,39}):/gi;

function getEmojiTokenIds(text: string) {
	return [...new Set([...text.matchAll(emojiTokenRegex)].map((match) => match[1].toLowerCase()))];
}

export function EmojiText({ text, emojiRefs = [] }: { text: string; emojiRefs?: ChatEmojiRef[] }) {
	const [resolvedRefs, setResolvedRefs] = useState<ChatEmojiRef[]>([]);
	const emojiById = useMemo(() => {
		const entries: Array<[string, ChatEmojiRef]> = [...emojiRefs, ...resolvedRefs].map((emoji) => [
			emoji.id.toLowerCase(),
			emoji
		]);
		return new Map(entries);
	}, [emojiRefs, resolvedRefs]);

	useEffect(() => {
		const missingIds = getEmojiTokenIds(text).filter((id) => !emojiById.has(id));
		if (missingIds.length === 0) {
			return;
		}

		let cancelled = false;
		void import('@/lib/player/emoji').then((emojiModule) => {
			if (cancelled) {
				return;
			}
			const nextRefs = missingIds
				.map((id) => emojiModule.getChatEmojiAsset(id, emojiRefs))
				.filter((emoji): emoji is ChatEmojiRef => Boolean(emoji));
			if (nextRefs.length > 0) {
				setResolvedRefs(nextRefs);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [emojiById, emojiRefs, text]);

	const parts: ReactNode[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(emojiTokenRegex)) {
		const [token, id] = match;
		const index = match.index ?? 0;
		const emoji = emojiById.get(id.toLowerCase());
		if (!emoji) {
			continue;
		}
		if (index > lastIndex) {
			parts.push(text.slice(lastIndex, index));
		}
		parts.push(
			<img
				key={`${emoji.id}-${index}`}
				src={emoji.src}
				alt={`:${emoji.id}:`}
				title={emoji.label}
				loading="lazy"
				decoding="async"
				className="chat-emoji"
			/>
		);
		lastIndex = index + token.length;
	}

	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return <>{parts.length ? parts : text}</>;
}
