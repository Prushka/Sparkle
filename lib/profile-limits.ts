import { backendFetch } from '@/lib/plex-access';
import { joinBackendPath } from '@/lib/player/data';

export type ProfileLimits = {
	maxPfpBytes: number;
	maxUsernameLength: number;
};

export async function fetchProfileLimits(
	base: string,
	signal?: AbortSignal
): Promise<ProfileLimits> {
	const response = await backendFetch(joinBackendPath(base, '/profile/limits'), {
		cache: 'no-store',
		signal
	});
	if (!response.ok) throw new Error('Unable to load profile limits. Please try again.');
	const limits = (await response.json()) as ProfileLimits;
	if (
		!Number.isSafeInteger(limits.maxPfpBytes) ||
		limits.maxPfpBytes < 1 ||
		!Number.isSafeInteger(limits.maxUsernameLength) ||
		limits.maxUsernameLength < 1
	)
		throw new Error('Unable to load profile limits. Please try again.');
	return limits;
}

// Match Go's rune count, including emoji and other non-BMP characters.
export function usernameLength(name: string) {
	return Array.from(name.trim()).length;
}

export function boundedUsername(name: string, limit: number) {
	return Array.from(name.trim()).slice(0, limit).join('');
}

export function usernameLimitError(limit: number) {
	return `Username must be ${limit} characters or fewer.`;
}

export function avatarLimitError(limit: number) {
	const bytes = `${limit.toLocaleString('en-US')} bytes`;
	const size =
		limit >= 1_000_000 ? `${Number((limit / 1_000_000).toFixed(2))} MB (${bytes})` : bytes;
	return `Avatar file is too large. Maximum size is ${size}.`;
}
