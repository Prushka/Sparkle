package config

import "testing"

func TestPlexPublicURL(t *testing.T) {
	for _, raw := range []string{"", "https://plex.example:32400", "https://plex.example/prefix/"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("PLEX_PUBLIC_URL", raw)
			cfg, err := Load()
			if err != nil || cfg.PlexPublicURL != raw {
				t.Fatalf("valid public URL rejected: %v", err)
			}
		})
	}
	for _, raw := range []string{"http://plex.example", "plex.example", "https://", "https://user:secret@plex.example", "https://plex.example?X-Plex-Token=secret", "https://plex.example?", "https://plex.example/#fragment"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("PLEX_PUBLIC_URL", raw)
			if _, err := Load(); err == nil {
				t.Fatal("invalid public URL accepted")
			}
		})
	}
}
