package config

import "testing"

func TestEncodedAudioSettings(t *testing.T) {
	t.Setenv("ENCODE_AUDIO_SURROUND_KBPS_PER_CHANNEL", "")
	// Removed overrides must not affect any channel count or reject startup.
	t.Setenv("ENCODE_AUDIO_KBPS", "invalid")
	t.Setenv("ENCODE_AUDIO_MONO_KBPS", "invalid")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EncodeAudioSurroundKbpsPerChannel != 80 {
		t.Fatal("incorrect default audio settings")
	}
	for _, tc := range []struct {
		value string
		want  int64
	}{{"32", 32}, {"96", 96}, {"128", 128}, {"31", 0}, {"129", 0}, {"nope", 0}} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv("ENCODE_AUDIO_SURROUND_KBPS_PER_CHANNEL", tc.value)
			cfg, err := Load()
			if tc.want == 0 {
				if err == nil {
					t.Fatal("invalid bitrate accepted")
				}
			} else if err != nil || cfg.EncodeAudioSurroundKbpsPerChannel != tc.want {
				t.Fatalf("audio override: per channel=%d want=%d error=%v", cfg.EncodeAudioSurroundKbpsPerChannel, tc.want, err)
			}
		})
	}
}
