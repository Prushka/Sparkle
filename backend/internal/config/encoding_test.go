package config

import "testing"

func TestEncodeConcurrency(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int64
	}{
		{"", 2}, {"1", 1}, {"8", 8}, {"9", 9}, {"32", 32},
		{"0", 0}, {"-1", 0}, {"33", 0}, {"invalid", 0},
	} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv("ENCODE_CONCURRENCY", tc.value)
			cfg, err := Load()
			if tc.want == 0 {
				if err == nil {
					t.Fatal("accepted invalid concurrency")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if cfg.EncodeConcurrency != tc.want {
				t.Fatalf("concurrency = %d, want %d", cfg.EncodeConcurrency, tc.want)
			}
		})
	}
}
