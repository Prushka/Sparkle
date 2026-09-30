package encode

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

// Channel order follows FFmpeg's native speaker masks. Custom layouts from
// ffprobe carry their ordered speaker list instead. Never infer a surround
// arrangement solely from its channel count.
var audioLayouts = map[string]string{
	"mono": "FC", "stereo": "FL+FR", "2.1": "FL+FR+LFE", "3.0": "FL+FR+FC",
	"3.0(back)": "FL+FR+BC", "4.0": "FL+FR+FC+BC", "quad": "FL+FR+BL+BR",
	"quad(side)": "FL+FR+SL+SR", "3.1": "FL+FR+FC+LFE",
	"5.0": "FL+FR+FC+BL+BR", "5.0(side)": "FL+FR+FC+SL+SR",
	"4.1": "FL+FR+FC+LFE+BC", "5.1": "FL+FR+FC+LFE+BL+BR",
	"5.1(side)": "FL+FR+FC+LFE+SL+SR", "6.0": "FL+FR+FC+BC+SL+SR",
	"6.0(front)": "FL+FR+FLC+FRC+SL+SR", "3.1.2": "FL+FR+FC+LFE+TFL+TFR",
	"hexagonal": "FL+FR+FC+BL+BR+BC", "6.1": "FL+FR+FC+LFE+BC+SL+SR",
	"6.1(back)": "FL+FR+FC+LFE+BL+BR+BC", "6.1(front)": "FL+FR+LFE+FLC+FRC+SL+SR",
	"7.0": "FL+FR+FC+BL+BR+SL+SR", "7.0(front)": "FL+FR+FC+FLC+FRC+SL+SR",
	"7.1": "FL+FR+FC+LFE+BL+BR+SL+SR", "7.1(wide)": "FL+FR+FC+LFE+BL+BR+FLC+FRC",
	"7.1(wide-side)": "FL+FR+FC+LFE+FLC+FRC+SL+SR",
	"5.1.2":          "FL+FR+FC+LFE+SL+SR+TFL+TFR", "5.1.2(back)": "FL+FR+FC+LFE+BL+BR+TFL+TFR",
	"octagonal": "FL+FR+FC+BL+BR+BC+SL+SR", "cube": "FL+FR+BL+BR+TFL+TFR+TBL+TBR",
	"5.1.4":         "FL+FR+FC+LFE+SL+SR+TFL+TFR+TBL+TBR",
	"7.1.2":         "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR",
	"7.1.4":         "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBL+TBR",
	"7.2.3":         "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBC+LFE2",
	"9.1.4":         "FL+FR+FC+LFE+BL+BR+FLC+FRC+SL+SR+TFL+TFR+TBL+TBR",
	"9.1.6":         "FL+FR+FC+LFE+BL+BR+FLC+FRC+SL+SR+TFL+TFR+TBL+TBR+TSL+TSR",
	"hexadecagonal": "FL+FR+FC+BL+BR+BC+SL+SR+TFL+TFC+TFR+TBL+TBC+TBR+WL+WR",
	"binaural":      "BIL+BIR", "downmix": "DL+DR",
	"22.2": "FL+FR+FC+LFE+BL+BR+FLC+FRC+BC+SL+SR+TC+TFL+TFC+TFR+TBL+TBC+TBR+LFE2+TSL+TSR+BFC+BFL+BFR",
}

type audioPlan struct {
	SourceChannels int    `json:"sourceChannels"`
	Channels       int    `json:"channels"`
	Layout         string `json:"layout"`
	Conversion     string `json:"conversion"`
	filter         string
}

func sourceSpeakers(s Stream) []string {
	layout := strings.TrimSpace(s.ChannelLayout)
	if layout == "" && s.Channels <= 2 {
		layout = []string{"", "mono", "stereo"}[s.Channels]
	}
	if named, ok := audioLayouts[layout]; ok {
		layout = named
	} else if prefix := fmt.Sprintf("%d channels (", s.Channels); strings.HasPrefix(layout, prefix) && strings.HasSuffix(layout, ")") {
		layout = strings.TrimSuffix(strings.TrimPrefix(layout, prefix), ")")
	}
	speakers := strings.Split(layout, "+")
	if len(speakers) != s.Channels {
		return nil
	}
	seen := map[string]bool{}
	for _, speaker := range speakers {
		if seen[speaker] || len(speakerTargets(speaker)) == 0 {
			return nil
		}
		seen[speaker] = true
	}
	return speakers
}

type speakerTarget struct {
	name string
	gain float64
}

// Explicit horizontal fold: no named height/wide/back-center signal is left
// to the resampler's default matrix, which can omit unsupported positions.
func speakerTargets(speaker string) []speakerTarget {
	if slices.Contains(strings.Split(audioLayouts["7.1"], "+"), speaker) {
		return []speakerTarget{{speaker, 1}}
	}
	switch speaker {
	case "BC":
		return []speakerTarget{{"BL", math.Sqrt(0.5)}, {"BR", math.Sqrt(0.5)}}
	case "FLC", "WL", "DL", "BIL":
		return []speakerTarget{{"FL", 1}}
	case "FRC", "WR", "DR", "BIR":
		return []speakerTarget{{"FR", 1}}
	case "TC", "TFC", "BFC":
		return []speakerTarget{{"FC", math.Sqrt(0.5)}}
	case "TFL", "BFL":
		return []speakerTarget{{"FL", math.Sqrt(0.5)}}
	case "TFR", "BFR":
		return []speakerTarget{{"FR", math.Sqrt(0.5)}}
	case "TBL":
		return []speakerTarget{{"BL", math.Sqrt(0.5)}}
	case "TBR":
		return []speakerTarget{{"BR", math.Sqrt(0.5)}}
	case "TBC":
		return []speakerTarget{{"BL", 0.5}, {"BR", 0.5}}
	case "TSL", "TTL":
		return []speakerTarget{{"SL", math.Sqrt(0.5)}}
	case "TSR", "TTR":
		return []speakerTarget{{"SR", math.Sqrt(0.5)}}
	case "SDL", "SSL":
		return []speakerTarget{{"SL", 1}}
	case "SDR", "SSR":
		return []speakerTarget{{"SR", 1}}
	case "LFE2":
		return []speakerTarget{{"LFE", 1}}
	}
	return nil
}

func planAudio(s Stream) (audioPlan, bool) {
	if s.Channels < 1 || s.Channels > 64 {
		return audioPlan{}, false
	}
	p := audioPlan{SourceChannels: s.Channels, Conversion: "preserved"}
	speakers := sourceSpeakers(s)
	if speakers != nil {
		for _, layout := range []string{"mono", "stereo", "3.0", "quad", "5.0", "5.1", "6.1", "7.1"} {
			// Keep side-only 5.x/quad in 7.1 so their speaker positions survive
			// both the Opus header and the browser's conventional outputs.
			if layout == "6.1" && !slices.Contains(speakers, "BC") {
				continue
			}
			positions := strings.Split(audioLayouts[layout], "+")
			if !slices.ContainsFunc(speakers, func(speaker string) bool { return !slices.Contains(positions, speaker) }) {
				p.Layout, p.Channels = layout, len(positions)
				if len(positions) != len(speakers) {
					p.Conversion = "padded"
				}
				if slices.Equal(speakers, positions) {
					p.filter = "aformat=channel_layouts=" + layout
					return p, true
				}
				break
			}
		}
	}
	if p.Layout == "" {
		p.Layout, p.Channels, p.Conversion = "7.1", 8, "downmix"
		if speakers == nil {
			// Unidentified channels have no defensible speaker positions. Fold
			// every even/odd channel to L/R instead of inventing an LFE channel
			// that would disappear on stereo devices.
			p.Layout, p.Channels, p.Conversion = "stereo", 2, "unknown"
		} else if s.ChannelLayout == "binaural" || s.ChannelLayout == "downmix" {
			p.Layout, p.Channels, p.Conversion = "stereo", 2, "preserved"
		}
	}
	positions := strings.Split(audioLayouts[p.Layout], "+")
	matrix := make([][]float64, len(positions))
	for i := range matrix {
		matrix[i] = make([]float64, s.Channels)
	}
	for channel := 0; channel < s.Channels; channel++ {
		targets := []speakerTarget{{positions[channel%len(positions)], 1}}
		if speakers != nil {
			targets = []speakerTarget{{speakers[channel], 1}}
			if p.Conversion == "downmix" || p.Layout == "stereo" {
				targets = speakerTargets(speakers[channel])
			}
		}
		for _, target := range targets {
			index := slices.Index(positions, target.name)
			if index < 0 {
				return audioPlan{}, false
			}
			matrix[index][channel] += target.gain
		}
	}
	// One common gain preserves relative speaker levels and prevents a full-
	// scale coherent input from clipping when channels are summed.
	peak := 1.0
	for _, row := range matrix {
		sum := 0.0
		for _, gain := range row {
			sum += math.Abs(gain)
		}
		peak = math.Max(peak, sum)
	}
	p.filter = "pan=" + p.Layout
	for i, row := range matrix {
		terms := []string{}
		for channel, gain := range row {
			if gain != 0 {
				terms = append(terms, strconv.FormatFloat(gain/peak, 'f', 9, 64)+"*c"+strconv.Itoa(channel))
			}
		}
		if len(terms) != 0 {
			p.filter += "|" + positions[i] + "=" + strings.Join(terms, "+")
		}
	}
	return p, true
}

func (p Probe) audioPlans() []audioPlan {
	plans := []audioPlan{}
	for _, s := range p.Streams {
		if s.Type == "audio" {
			plan, _ := planAudio(s)
			plans = append(plans, plan)
		}
	}
	return plans
}

func (p Probe) audioChannels() int {
	channels := 0
	for _, plan := range p.audioPlans() {
		channels = max(channels, plan.Channels)
	}
	return channels
}
