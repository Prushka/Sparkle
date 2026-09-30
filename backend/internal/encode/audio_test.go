package encode

import (
	"fmt"
	"strings"
	"testing"
)

func TestAudioLayoutPlans(t *testing.T) {
	for _, tc := range []struct {
		input              string
		channels           int
		layout, conversion string
		width              int
	}{
		{"2.1", 3, "5.1", "padded", 6},
		{"3.0(back)", 3, "6.1", "padded", 7},
		{"4.0", 4, "6.1", "padded", 7},
		{"3.1", 4, "5.1", "padded", 6},
		{"4.1", 5, "6.1", "padded", 7},
		{"quad(side)", 4, "7.1", "padded", 8},
		{"6.0", 6, "6.1", "padded", 7},
		{"7.0", 7, "7.1", "padded", 8},
		{"7.1(wide)", 8, "7.1", "downmix", 8},
		{"7.1(wide-side)", 8, "7.1", "downmix", 8},
		{"6.1(back)", 7, "7.1", "downmix", 8},
		{"7.1.4", 12, "7.1", "downmix", 8},
		{"22.2", 24, "7.1", "downmix", 8},
		{"3 channels (FR+FL+LFE)", 3, "5.1", "padded", 6},
		{"FL+FR+TFL+TFR", 4, "7.1", "downmix", 8},
		{"binaural", 2, "stereo", "preserved", 2},
		{"downmix", 2, "stereo", "preserved", 2},
		{"", 9, "stereo", "unknown", 2},
		{"9 channels", 9, "stereo", "unknown", 2},
		{"unknown", 64, "stereo", "unknown", 2},
	} {
		t.Run(fmt.Sprintf("%s/%d", tc.input, tc.channels), func(t *testing.T) {
			p, ok := planAudio(Stream{Channels: tc.channels, ChannelLayout: tc.input})
			if !ok || p.Layout != tc.layout || p.Channels != tc.width || p.Conversion != tc.conversion {
				t.Fatalf("plan: %+v, ok=%v", p, ok)
			}
			if p.filter == "" || p.SourceChannels != tc.channels {
				t.Fatal("missing filter or source width")
			}
		})
	}
	for name, speakers := range audioLayouts {
		channels := len(strings.Split(speakers, "+"))
		if _, ok := planAudio(Stream{Channels: channels, ChannelLayout: name}); !ok {
			t.Errorf("named layout rejected: %s", name)
		}
	}
}

func TestAudioMixIncludesEverySourceAndBoundsGain(t *testing.T) {
	for _, s := range []Stream{
		{Channels: 12, ChannelLayout: "7.1.4"},
		{Channels: 24, ChannelLayout: "22.2"},
		{Channels: 9},
		{Channels: 64},
	} {
		p, ok := planAudio(s)
		if !ok {
			t.Fatal("rejected layout")
		}
		for i := 0; i < s.Channels; i++ {
			// Split terms so c1 cannot accidentally match c10.
			found := false
			for _, term := range strings.FieldsFunc(p.filter, func(r rune) bool { return r == '+' || r == '|' }) {
				found = found || strings.HasSuffix(term, fmt.Sprintf("*c%d", i))
			}
			if !found {
				t.Errorf("channel %d dropped: %s", i, p.filter)
			}
		}
	}
	p, _ := planAudio(Stream{Channels: 3, ChannelLayout: "3 channels (FR+FL+LFE)"})
	if !strings.Contains(p.filter, "FL=1.000000000*c1|FR=1.000000000*c0") {
		t.Fatal("custom speaker order was lost")
	}
	p, _ = planAudio(Stream{Channels: 8, ChannelLayout: "7.1(wide)"})
	if !strings.Contains(p.filter, "FL=0.500000000*c0+0.500000000*c6") || !strings.Contains(p.filter, "FC=0.500000000*c2") {
		t.Fatal("wide fold must use a common gain to bound peaks and retain speaker balance")
	}
}

func TestConvertedAudioBitrateAndMapping(t *testing.T) {
	for _, tc := range []struct {
		channels             int
		layout, rate, family string
	}{
		{3, "2.1", "240k", "1"},
		{5, "4.1", "400k", "1"},
		{12, "7.1.4", "640k", "1"},
		{24, "22.2", "640k", "1"},
		{12, "", "160k", "0"},
		{1, "LFE", "80k", "1"},
	} {
		for _, codec := range []string{"av1", "hevc"} {
			source := Probe{Streams: []Stream{{Type: "video"}, {Type: "audio", Channels: tc.channels, ChannelLayout: tc.layout}}}
			args := strings.Join(encodeArgs("fixture", t.TempDir(), codec, 0, 30, Profile{Quality: 24, Preset: "p3", AudioSurroundKbpsPerChannel: 80}, source), " ")
			want := "-b:a:0 " + tc.rate + " -mapping_family:a:0 " + tc.family
			if !strings.Contains(args, want) {
				t.Fatalf("%s %s: missing %s", codec, tc.layout, want)
			}
		}
	}
}
