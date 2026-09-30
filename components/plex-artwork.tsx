'use client';

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithRef,
	type ReactNode
} from 'react';
import type { PlexArtworkCredentials, PlexArtworkPaths } from '@/lib/plex-artwork';

const artworkPath = /^\/library\/metadata\/[0-9]+\/(thumb|art)(\/[0-9]+)?$/;
type Session = {
	credentials: PlexArtworkCredentials;
	libraryIds: readonly string[];
	failures: Map<string, ReturnType<typeof setTimeout>>;
};
const Artwork = createContext<{ ready: boolean; session: Session | null }>({
	ready: true,
	session: null
});
const noLibraries: readonly string[] = [];

export function PlexArtworkProvider({
	children,
	ready,
	credentials,
	libraryIds = noLibraries,
	sessionKey
}: {
	children: ReactNode;
	ready: boolean;
	credentials: PlexArtworkCredentials | null;
	libraryIds?: readonly string[];
	sessionKey: number;
}) {
	const value = useMemo(
		() => ({
			ready,
			sessionKey,
			session: credentials
				? { credentials, libraryIds, failures: new Map<string, ReturnType<typeof setTimeout>>() }
				: null
		}),
		[ready, credentials, libraryIds, sessionKey]
	);
	useEffect(
		() => () => {
			for (const timer of value.session?.failures.values() || []) clearTimeout(timer);
			value.session?.failures.clear();
		},
		[value]
	);
	return <Artwork.Provider value={value}>{children}</Artwork.Provider>;
}

function rememberFailure(session: Session | null, key: string) {
	if (!session || session.failures.has(key)) return;
	while (session.failures.size >= 128) {
		const oldest = session.failures.keys().next().value!;
		clearTimeout(session.failures.get(oldest));
		session.failures.delete(oldest);
	}
	session.failures.set(
		key,
		setTimeout(() => session.failures.delete(key), 4 * 60_000)
	);
}

function directURL(
	session: Session | null,
	artwork: PlexArtworkPaths | undefined,
	kind: 'poster' | 'backdrop'
) {
	const path = artwork?.[kind];
	if (
		!session ||
		!artwork ||
		!path ||
		!artworkPath.test(path) ||
		!session.libraryIds.includes(artwork.libraryId)
	)
		return '';
	const { baseUrl, token, expiresAt } = session.credentials;
	if (!token || !Number.isFinite(expiresAt)) return '';
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
			return '';
		url.pathname = url.pathname.replace(/\/+$/, '') + path;
		url.searchParams.set('X-Plex-Token', token);
		return url.href;
	} catch {
		return '';
	}
}

export function PlexArtworkImage({
	src = '',
	artwork,
	kind = 'poster',
	alt = '',
	onError,
	onLoad,
	ref,
	...props
}: Omit<ComponentPropsWithRef<'img'>, 'src'> & {
	src?: string;
	artwork?: PlexArtworkPaths;
	kind?: 'poster' | 'backdrop';
}) {
	const element = useRef<HTMLImageElement | null>(null);
	const imageRef = useCallback(
		(node: HTMLImageElement | null) => {
			element.current = node;
			const cleanup = typeof ref === 'function' ? ref(node) : undefined;
			if (ref && typeof ref !== 'function') ref.current = node;
			return () => {
				element.current = null;
				if (typeof cleanup === 'function') cleanup();
				else if (typeof ref === 'function') ref(null);
				else if (ref) ref.current = null;
			};
		},
		[ref]
	);
	const { ready, session } = useContext(Artwork);
	const target = directURL(session, artwork, kind);
	const key = `${src}:${artwork?.[kind] || ''}`;
	const [state, setState] = useState<{
		key: string;
		session: Session | null;
		phase: 'loaded' | 'fallback' | 'hidden';
	} | null>(null);
	if (state && (state.key !== key || state.session !== session)) setState(null);
	const current = state?.key === key && state.session === session ? state : null;
	const cachedFailure = session?.failures.has(key);
	const direct =
		ready &&
		!!target &&
		!cachedFailure &&
		current?.phase !== 'fallback' &&
		current?.phase !== 'hidden';
	const display = !ready && artwork ? undefined : direct ? target : src;
	function fallback() {
		rememberFailure(session, key);
		setState({ key, session, phase: 'fallback' });
	}
	useEffect(() => {
		if (!direct || current?.phase === 'loaded') return;
		// A grant refresh can retain the same URL and already-loaded DOM image.
		if (
			element.current?.complete &&
			element.current.naturalWidth > 0 &&
			element.current.getAttribute('src') === target
		)
			return;
		const timer = setTimeout(() => {
			rememberFailure(session, key);
			setState({ key, session, phase: 'fallback' });
		}, 8_000);
		return () => clearTimeout(timer);
	}, [direct, current?.phase, key, session, target]);
	if (current?.phase === 'hidden') return null;
	return (
		// Plex handles image bytes directly; the optimizer and CORS are unnecessary.
		// eslint-disable-next-line @next/next/no-img-element
		<img
			{...props}
			ref={imageRef}
			src={display}
			alt={alt}
			crossOrigin={undefined}
			referrerPolicy="no-referrer"
			onLoad={(event) => {
				if (event.currentTarget.getAttribute('src') !== display) return;
				if (direct) setState({ key, session, phase: 'loaded' });
				onLoad?.(event);
			}}
			onError={(event) => {
				if (event.currentTarget.getAttribute('src') !== display) return;
				if (direct) fallback();
				else {
					setState({ key, session, phase: 'hidden' });
					onError?.(event);
				}
			}}
		/>
	);
}
