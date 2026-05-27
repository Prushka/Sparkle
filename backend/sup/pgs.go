package sup

import (
	"time"

	"github.com/labstack/gommon/log"
	"github.com/mbiamont/go-pgs-parser/displaySet"
	"github.com/mbiamont/go-pgs-parser/pgs"
)

func ParsePGSFile(filePath string) (subs []ImageSubtitle, err error) {
	var currentSub *ImageSubtitle
	err = pgs.NewPgsParser().ParseDisplaySets(filePath, func(data displaySet.DisplaySet, startTime time.Duration) error {
		// Check if this display set contains an image or only metadata
		imageData, err := data.ToImageData()
		if err != nil {
			return err
		}
		if imageData != nil {
			// We got a new image, so this should be the start of a new sub
			if currentSub != nil {
				log.Debugf("WARNING: got an image without a previous end time for the previous sub: overwriting (current valid subs: %d)", len(subs))
				currentSub = nil
			}
			currentSub = &ImageSubtitle{
				Image:     imageData.Image,
				StartTime: startTime,
			}
		} else {
			// No image in this display set, so it should be the end of the previous one
			if currentSub == nil {
				log.Debugf("WARNING: got an end time without a previous start time for a previous sub: skipping (current valid subs: %d)", len(subs))
			} else {
				currentSub.EndTime = startTime
				subs = append(subs, *currentSub)
				currentSub = nil
			}
		}
		return nil
	})
	return
}
