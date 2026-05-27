package sup

import (
	"fmt"

	"github.com/hekmon/go-vobsub"
)

func ParseVobSubFile(filePath string) (subs map[int][]ImageSubtitle, err error) {
	dvdSubtitles, _, err := vobsub.Decode(filePath, true) // some images are too small for Qwen2.5-VL, using video stream resolution instead
	if err != nil {
		err = fmt.Errorf("failed to decode vobsub file: %w", err)
		return
	}
	subs = make(map[int][]ImageSubtitle, len(dvdSubtitles))
	for streamID, streamSubs := range dvdSubtitles {
		adaptedSubs := make([]ImageSubtitle, len(streamSubs))
		for i, sub := range streamSubs {
			adaptedSubs[i] = ImageSubtitle{
				Image:     sub.Image,
				StartTime: sub.Start,
				EndTime:   sub.Stop,
			}
		}
		subs[streamID] = adaptedSubs
	}
	return
}
