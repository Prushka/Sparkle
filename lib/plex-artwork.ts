// Credential-free artwork metadata may travel with catalog and title data.
export type PlexArtworkPaths = {
	libraryId: string;
	poster?: string;
	backdrop?: string;
};

// Only the private session response supplies these; never put them in media data.
export type PlexArtworkCredentials = {
	baseUrl: string;
	token: string;
	expiresAt: number;
};
