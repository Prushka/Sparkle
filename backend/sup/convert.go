package sup

import (
	"Sparkle/config"
	"Sparkle/discord"
	"Sparkle/utils"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/gommon/log"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

var oaiClient openai.Client
var oaiInitialized bool

const openaiTimeout = 30 * time.Minute

func initOpenAIClient() {
	if oaiInitialized {
		return
	}
	oaiClient = openai.NewClient(
		option.WithRequestTimeout(openaiTimeout),
		option.WithBaseURL(config.TheConfig.OCRVLMUrl),
	)
	oaiInitialized = true
}

func processSubsImages(imgSubs []ImageSubtitle, outputPath string) error {
	fd, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to write the output test file: %w", err)
	}
	defer func(fd *os.File) {
		err := fd.Close()
		if err != nil {
			log.Errorf("failed to close file: %v", err)
		}
	}(fd)
	start := time.Now()
	srtSubs, err := OCR(imgSubs)
	if err != nil {
		return fmt.Errorf("OCR failed: %w", err)
	}
	discord.Infof("OCR completed in %v", time.Since(start))
	if err = srtSubs.Marshal(fd); err != nil {
		return fmt.Errorf("failed to write VTT: %s", err)
	}
	discord.Infof("VTT written to %v", outputPath)
	return nil
}

func Convert(inputPath string) error {
	initOpenAIClient()
	outputPath := utils.ReplaceExtension(inputPath, ".vtt")
	// Step 1 - Parse subtitle file
	var subs map[int][]ImageSubtitle
	if strings.HasSuffix(inputPath, ".sup") {
		discord.Infof("Parsing PGS file %v", filepath.Base(inputPath))
		imgSubs, err := ParsePGSFile(inputPath)
		if err != nil {
			return fmt.Errorf("failed to parse PGS file: %w", err)
		}
		for _, sub := range imgSubs {
			log.Debugf("Start: %v, End: %v, Size: %d×%v",
				sub.StartTime, sub.EndTime, sub.Image.Bounds().Dx(), sub.Image.Bounds().Dy(),
			)
		}
		discord.Infof("PGS file parsed. Total subs: %d", len(imgSubs))
		if len(imgSubs) == 0 {
			return fmt.Errorf("no subtitles found in the PGS file")
		}
		subs = map[int][]ImageSubtitle{
			0: imgSubs,
		}
	} else {
		discord.Infof("Parsing VobSub file %v", filepath.Base(inputPath))
		var err error
		subs, err = ParseVobSubFile(inputPath)
		if err != nil {
			return fmt.Errorf("failed to parse VobSub file: %w", err)
		}
		var (
			subIndex  string
			totalSubs int
		)
		for index, imgSubs := range subs {
			if len(subs) > 1 {
				subIndex = fmt.Sprintf("[%d] ", index)
			}
			totalSubs += len(imgSubs)
			for _, sub := range imgSubs {
				log.Debugf("%sStart: %v, End: %v, Size: %d×%v",
					subIndex, sub.StartTime, sub.EndTime,
					sub.Image.Bounds().Dx(), sub.Image.Bounds().Dy(),
				)
			}
		}
		if len(subs) > 1 {
			subIndex = fmt.Sprintf(" (over %d streams)", len(subs))
		}
		discord.Infof("VobSub file parsed. Total subs: %d%s", totalSubs, subIndex)
		if totalSubs == 0 {
			return fmt.Errorf("no subtitles found in the VobSub file")
		}
	}

	// Step 2 - OCR with AI
	for streamID, streamSubs := range subs {
		var finalOutputPath string
		if len(subs) > 1 {
			dirPath := filepath.Dir(outputPath)
			file := filepath.Base(outputPath)
			extension := filepath.Ext(file)
			fileName := file[:len(file)-len(extension)]
			finalOutputPath = filepath.Join(dirPath, fmt.Sprintf("%s_stream-%d%s", fileName, streamID, extension))
			discord.Infof("Stream #%d", streamID)
		} else {
			finalOutputPath = outputPath
		}
		// Start process
		if err := processSubsImages(streamSubs, finalOutputPath); err != nil {
			return fmt.Errorf("failed to process subtitle images: %w", err)
		}
		if finalOutputPath != outputPath {
			discord.Infof("")
		}
	}
	return nil
}
