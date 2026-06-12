'use client';

import { type ChangeEvent, type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import { IconArrowRight } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type RoomNavigationInputProps = {
	className?: string;
	inputClassName?: string;
	buttonClassName?: string;
	inputId?: string;
	placeholder?: string;
};

function isAbsoluteRoomUrl(value: string) {
	return /^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.startsWith('//');
}

function getRoomNavigationTarget(value: string, currentLocation: Location) {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return null;
	}

	const sameHostUrl =
		trimmedValue === currentLocation.host || trimmedValue.startsWith(`${currentLocation.host}/`)
			? `${currentLocation.protocol}//${trimmedValue}`
			: trimmedValue;
	const shouldTreatAsUrl =
		isAbsoluteRoomUrl(sameHostUrl) || sameHostUrl.startsWith('/') || sameHostUrl.startsWith('#');

	if (shouldTreatAsUrl) {
		try {
			const target = new URL(sameHostUrl, currentLocation.origin);
			return target.host === currentLocation.host ? target.href : null;
		} catch {
			return null;
		}
	}

	const roomId = trimmedValue.replace(/^\/+|\/+$/g, '');
	if (!roomId) {
		return null;
	}

	const target = new URL(`/${encodeURIComponent(roomId)}`, currentLocation.origin);
	return target.href;
}

export function RoomNavigationInput({
	className,
	inputClassName,
	buttonClassName,
	inputId,
	placeholder = 'Room URL or ID'
}: RoomNavigationInputProps) {
	const generatedInputId = useId();
	const resolvedInputId = inputId ?? generatedInputId;
	const [value, setValue] = useState('');
	const [invalid, setInvalid] = useState(false);

	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		setValue(event.target.value);
		if (invalid) {
			setInvalid(false);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (
			event.key !== 'Enter' ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.nativeEvent.isComposing
		) {
			return;
		}

		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		const target = getRoomNavigationTarget(value, window.location);
		if (!target) {
			setInvalid(true);
			return;
		}

		setInvalid(false);
		window.location.assign(target);
	}

	return (
		<form
			className={cn(
				'flex h-10 min-w-0 items-center overflow-hidden rounded-md border bg-background/70 shadow-sm backdrop-blur-sm transition-colors',
				invalid ? 'border-destructive' : 'border-input',
				className,
				invalid && 'border-destructive'
			)}
			aria-label="Open room"
			onSubmit={handleSubmit}
		>
			<label className="sr-only" htmlFor={resolvedInputId}>
				Room URL or ID
			</label>
			<Input
				id={resolvedInputId}
				value={value}
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				autoComplete="off"
				autoCapitalize="none"
				spellCheck={false}
				aria-invalid={invalid}
				className={cn(
					'h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 py-1 text-sm shadow-none focus-visible:ring-0',
					inputClassName
				)}
			/>
			<Button
				type="submit"
				variant="ghost"
				className={cn(
					'h-full w-10 flex-none rounded-none border-l p-0',
					invalid
						? 'border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive'
						: 'border-border/70 text-muted-foreground hover:text-foreground',
					buttonClassName,
					invalid &&
						'border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive'
				)}
				aria-label="Open room"
			>
				<IconArrowRight size={17} stroke={2} />
			</Button>
		</form>
	);
}
