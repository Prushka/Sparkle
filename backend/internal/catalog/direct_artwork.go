package catalog

import (
	"context"

	"Sparkle/internal/plex"
)

// PlexArtwork contains no host or credential. Public poster URLs remain proxies.
type PlexArtwork struct {
	LibraryID string `json:"libraryId"`
	Poster    string `json:"poster,omitempty"`
	Backdrop  string `json:"backdrop,omitempty"`
}

func metadataArtwork(m plex.Metadata) *PlexArtwork {
	poster, backdrop := plex.MetadataArtworkPath(m, "poster"), plex.MetadataArtworkPath(m, "backdrop")
	if m.SectionID == "" || (poster == "" && backdrop == "") {
		return nil
	}
	return &PlexArtwork{LibraryID: m.SectionID, Poster: poster, Backdrop: backdrop}
}

func (s *Service) authorizedArtwork(ctx context.Context, artwork *PlexArtwork) *PlexArtwork {
	if artwork == nil || !s.permitsLibrary(ctx, artwork.LibraryID) {
		return nil
	}
	return artwork
}
