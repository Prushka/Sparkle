'use client';

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ComponentPropsWithRef,
	type ReactNode
} from 'react';
import { joinBackendPath, loadRuntimeConfig } from '@/lib/player/data';

const lifetime = 4 * 60_000;
const timeout = 8_000;
const artworkPath =
	/\/(?:media\/plex-[a-f0-9]{12}-\d+-\d+\/artwork\/(?:poster|backdrop)|library\/artwork\/[A-Za-z0-9_.-]+)$/;

function artworkSession() {
	const entries = new Map<
		string,
		{ promise: Promise<string>; controller: AbortController; expires: number }
	>();
	return {
		resolve(src: string) {
			const cached = entries.get(src);
			if (cached && cached.expires > Date.now()) return cached.promise;
			cached?.controller.abort();
			entries.delete(src);
			while (entries.size >= 128) {
				const oldest = entries.keys().next().value!;
				entries.get(oldest)?.controller.abort();
				entries.delete(oldest);
			}
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout);
			const promise = (async () => {
				try {
					const config = await loadRuntimeConfig();
					const source = new URL(src, location.href);
					const backend = new URL(joinBackendPath(config.backendBaseUrl, '/'), location.href);
					if (
						source.origin !== backend.origin ||
						!source.pathname.startsWith(backend.pathname) ||
						source.search ||
						source.hash
					)
						return src;
					const response = await fetch(`${source.href}/direct`, {
						method: 'POST',
						credentials: 'include',
						cache: 'no-store',
						redirect: 'error',
						headers: { 'X-Sparkle-Auth': '1' },
						signal: controller.signal
					});
					if (!response.ok) return src;
					const data = await response.json();
					const direct = new URL(data.url);
					return !controller.signal.aborted &&
						direct.protocol === 'https:' &&
						!direct.username &&
						!direct.password
						? direct.href
						: src;
				} catch {
					// Never log a failed request: it may contain the viewer's token.
					return src;
				} finally {
					clearTimeout(timer);
				}
			})();
			entries.set(src, { promise, controller, expires: Date.now() + lifetime });
			return promise;
		},
		fallback(src: string) {
			const entry = entries.get(src);
			if (entry) entry.promise = Promise.resolve(src);
		},
		clear() {
			for (const entry of entries.values()) entry.controller.abort();
			entries.clear();
		}
	};
}

type Session = ReturnType<typeof artworkSession>;
const Artwork = createContext<{ ready: boolean; session: Session | null }>({
	ready: true,
	session: null
});

export function PlexArtworkProvider({
	children,
	ready,
	enabled,
	sessionKey
}: {
	children: ReactNode;
	ready: boolean;
	enabled: boolean;
	sessionKey: number;
}) {
	// The key changes for account, authorization or sign-out changes. These URLs
	// belong only to this provider instance, never catalog data or browser storage.
	const value = useMemo(
		() => ({ ready, session: enabled ? artworkSession() : null, sessionKey }),
		[ready, enabled, sessionKey]
	);
	useEffect(() => () => value.session?.clear(), [value]);
	return <Artwork.Provider value={value}>{children}</Artwork.Provider>;
}

function useArtwork(src: string) {
	const { ready, session } = useContext(Artwork);
	const eligible = artworkPath.test(src);
	const [resolved, setResolved] = useState<{
		source: string;
		session: Session;
		url: string;
		loaded: boolean;
	} | null>(null);
	// Clear before rendering a different account's image, including late results.
	if (resolved && (resolved.source !== src || resolved.session !== session || !ready))
		setResolved(null);
	useEffect(() => {
		if (!ready || !session || !eligible) return;
		let active = true;
		void session.resolve(src).then((url) => {
			if (active) setResolved({ source: src, session, url, loaded: false });
		});
		return () => {
			active = false;
		};
	}, [src, ready, session, eligible]);
	const current =
		resolved?.source === src && resolved.session === session && ready ? resolved : null;
	const url = !eligible ? src : !ready ? undefined : session ? current?.url : src;
	const direct = !!url && url !== src;
	useEffect(() => {
		if (!direct || !session || current?.loaded) return;
		const timer = setTimeout(() => {
			session.fallback(src);
			setResolved({ source: src, session, url: src, loaded: false });
		}, timeout);
		return () => clearTimeout(timer);
	}, [direct, session, src, current?.loaded]);
	return {
		src: url,
		onLoad() {
			if (current) setResolved({ ...current, loaded: true });
		},
		onError() {
			if (direct && session) {
				session.fallback(src);
				setResolved({ source: src, session, url: src, loaded: false });
			}
		}
	};
}

export function PlexArtworkImage({
	src = '',
	alt = '',
	onError,
	onLoad,
	...props
}: Omit<ComponentPropsWithRef<'img'>, 'src'> & { src?: string }) {
	const artwork = useArtwork(src);
	const [failed, setFailed] = useState('');
	if (failed === src && src) return null;
	return (
		// Direct Plex images cannot go through the Next image optimizer or require CORS.
		// eslint-disable-next-line @next/next/no-img-element
		<img
			{...props}
			src={artwork.src}
			alt={alt}
			crossOrigin={undefined}
			referrerPolicy="no-referrer"
			onLoad={(event) => {
				artwork.onLoad();
				onLoad?.(event);
			}}
			onError={(event) => {
				if (event.currentTarget.getAttribute('src') !== artwork.src) return;
				if (artwork.src === src) {
					setFailed(src);
					onError?.(event);
				} else artwork.onError();
			}}
		/>
	);
}
