package config

import "testing"

func TestAIHDRFlag(t *testing.T) {
	for _, value := range []string{"", "false", "true", "invalid"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("AI_HDR_ENABLED", value)
			cfg, err := Load()
			if value == "invalid" {
				if err == nil {
					t.Fatal("accepted invalid flag")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if cfg.AIHDREnabled != (value == "true") {
				t.Fatalf("flag %q: %v", value, cfg.AIHDREnabled)
			}
		})
	}
}
