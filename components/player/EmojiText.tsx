'use client';

/* eslint-disable @next/next/no-img-element -- Emotes can be animated third-party images. */

import type { ReactNode } from 'react';
import { getChatEmojiAsset, type ChatEmojiRef } from '@/lib/player/emoji';

const emojiTokenRegex = /:([a-z0-9][a-z0-9_+-]{1,39}):/gi;

export function EmojiText({ text, emojiRefs = [] }: { text: string; emojiRefs?: ChatEmojiRef[] }) {
	const parts: ReactNode[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(emojiTokenRegex)) {
		const [token, id] = match;
		const index = match.index ?? 0;
		const emoji = getChatEmojiAsset(id, emojiRefs);
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
