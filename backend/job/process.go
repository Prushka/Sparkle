package job

import (
	"Sparkle/config"
	"Sparkle/discord"
	"Sparkle/sup"
	"Sparkle/translation"
	"Sparkle/utils"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cenkalti/dominantcolor"
	log "github.com/sirupsen/logrus"
	"golang.org/x/sync/errgroup"
)

func (job *Job) extractChapters() error {
	cmd := exec.Command(config.TheConfig.Ffprobe, "-v", "quiet", "-print_format", "json", "-show_chapters", job.InputJoin(job.Input))
	out, err := utils.RunCommand(cmd)
	if err != nil {
		return err
	}
	var probeOutput FFProbeOutput
	err = json.Unmarshal(out, &probeOutput)
	if err != nil {
		return err
	}
	job.Chapters = probeOutput.Chapters
	discord.Infof("Chapters: %+v", job.Chapters)
	return nil
}

func ContainsSubtitles(path string) (bool, error) {
	// Run ffprobe command to get subtitle codec names
	cmd := exec.Command("ffprobe", "-v", "error", "-select_streams", "s", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path)
	output, err := utils.RunCommand(cmd)
	if err != nil {
		return false, fmt.Errorf("ffprobe error: %v", err)
	}

	codecs := strings.Split(string(output), "\n")

	for _, codec := range codecs {
		codec = strings.ToLower(codec)
		if codec != "" {
			return true, nil // Found a subtitle
		}
	}
	return false, nil
}

func isCodecNameText(codec string) bool {
	return codec != "" && !strings.Contains(codec, "image") && !strings.Contains(codec, "pgs") && !strings.Contains(codec, "dvd")
}

func (job *Job) ExtractStreams(path, t string) error {
	cmd := exec.Command(config.TheConfig.Ffprobe, "-v", "quiet", "-print_format", "json", "-show_streams", path)
	out, err := utils.RunCommand(cmd)
	if err != nil {
		return err
	}
	var probeOutput FFProbeOutput
	if err := json.Unmarshal(out, &probeOutput); err != nil {
		return err
	}
	meaningful := false
	for _, stream := range probeOutput.Streams {
		if stream.CodecType == t {
			meaningful = true
			log.Debugf("Stream: %+v", stream)
			id := fmt.Sprintf("%d-%s", stream.Index, stream.Tags.Language)
			convert := func(codec, cs, filename string) error {
				var cmd *exec.Cmd
				log.Debugf("Handling %s stream #%d (%s)", stream.CodecType, stream.Index, stream.CodecName)
				s := Stream{
					CodecName: codec,
					CodecType: stream.CodecType,
					Index:     stream.Index,
					Language:  stream.Tags.Language,
					Title:     stream.Tags.Title,
					Filename:  stream.Tags.Filename,
					MimeType:  stream.Tags.MimeType,
					Location:  filename,
					Channels:  stream.Channels,
				}
				if stream.CodecType == AttachmentType {
					cmd = exec.Command(config.TheConfig.Ffmpeg, "-y", fmt.Sprintf("-dump_attachment:%d", stream.Index), job.OutputJoin(filename), "-i", path, "-t", "0", "-f", "null", "null")
				} else if cs == "webvttFromASS" {
					if err := translation.AssToVTT(job.OutputJoin(fmt.Sprintf("%s.ass", id))); err != nil {
						return err
					}
				} else if cs == "assFromWebvtt" {
					cmd = exec.Command(config.TheConfig.Ffmpeg, "-y", "-i",
						job.OutputJoin(utils.ReplaceExtension(filename, ".vtt")),
						"-c:s", "ass", job.OutputJoin(filename))
				} else if cs == "mkvextract" {
					cmd = exec.Command(config.TheConfig.MKVExtract, "tracks", path, fmt.Sprintf("%d:%s", stream.Index, job.OutputJoin(filename)))
				} else {
					csFlag := "-c:s"
					if stream.CodecType == AudioType {
						csFlag = "-c:a"
					}
					cmd = exec.Command(config.TheConfig.Ffmpeg, "-y", "-i", path, csFlag, cs, "-map", fmt.Sprintf("0:%d", stream.Index), job.OutputJoin(filename))
				}
				if cmd != nil {
					if _, err := utils.RunCommand(cmd); err != nil {
						return fmt.Errorf("error extracting %s stream #%d (%s): %v", stream.CodecType, stream.Index, stream.CodecName, err)
					}
				}
				job.Streams = append(job.Streams, s)
				return nil
			}
			switch stream.CodecType {
			case SubtitlesType:
				copySubtitle := func() error {
					if stream.Tags.Language != "eng" {
						discord.Infof("non-eng image subtitle, skipping: %s", stream.Tags.Language)
						return nil
					}
					toCodec, ok := codecMap[stream.CodecName]
					if !ok {
						toCodec = stream.CodecName
					}
					filename := fmt.Sprintf("%s.%s", id, toCodec)
					success := func() error {
						if err := sup.Convert(job.OutputJoin(filename)); err != nil {
							return fmt.Errorf("VLM image based convert: %v", err)
						}
						if err := convert("ass", "assFromWebvtt", fmt.Sprintf("%s.ass", id)); err != nil {
							return fmt.Errorf("VLM image based subtitle conversion (vtt -> ass): %s: %v", t, err)
						}
						return nil
					}
					switch toCodec {
					case "sup":
						if err := convert(toCodec, "copy", filename); err != nil {
							return err
						}
						return success()
					case "sub":
						if err := convert(toCodec, "mkvextract", filename); err == nil {
							return err
						}
						return success()
					default:
						return fmt.Errorf("unknown codec: %s", stream.CodecType)
					}
				}
				if !isCodecNameText(stream.CodecName) {
					if err := copySubtitle(); err != nil {
						return err
					}
				} else {
					// for any text-based subtitle, it always tries to produce .ass and .vtt
					if err := convert("ass", "ass", fmt.Sprintf("%s.ass", id)); err != nil {
						return fmt.Errorf("failed to convert %s to ass, %w", id, err)
					}
					if err := convert("webvtt", "webvttFromASS", fmt.Sprintf("%s.vtt", id)); err != nil {
						return fmt.Errorf("failed to convert %s to webvtt, %w", id, err)
					}
					// errVtt = convert("webvtt", "webvtt", fmt.Sprintf("%s.vtt", id))
				}
			case AudioType:
				if err := convert(stream.CodecName, "copy", fmt.Sprintf("%s.%s", id, stream.CodecName)); err != nil {
					return err
				}
			case AttachmentType:
				if err := convert(stream.Tags.MimeType, "copy", stream.Tags.Filename); err != nil {
					return err
				}
			}
		}
	}
	if !meaningful && (t == AudioType || t == SubtitlesType) {
		return fmt.Errorf("no %s streams found in %s", t, path)
	}
	return nil
}

func (job *Job) ffmpegCopyOnly() error {
	outputFile := job.OutputJoin(fmt.Sprintf("hevc.%s", config.TheConfig.VideoExt))
	discord.Infof("Converting video: %s -> %s", job.Input, outputFile)
	args := []string{
		"-i", job.InputJoin(job.Input),
		"-map", "0:v",
		"-c:v", "copy",
		"-map", "0:a",
		"-c:a", "libopus",
		"-ac", "2",
		"-b:a", fmt.Sprintf("%dk", config.TheConfig.AudioKbps),
		"-map", "-0:s",
		outputFile,
	}
	cmd := exec.Command(
		config.TheConfig.Ffmpeg, args...)
	_, err := utils.RunCommand(cmd)
	if err == nil {
		job.EncodedCodecs = append(job.EncodedCodecs, "hevc")
	}
	return err
}

func (job *Job) handbrakeTranscode() error {
	encoders := strings.Split(config.TheConfig.Encoder, ",")
	wg := sync.WaitGroup{}
	job.EncodedExt = config.TheConfig.VideoExt
	runEncoder := func(encoder, encoderCmd, encoderPreset, encoderProfile, encoderTune string) {
		outputFile := job.OutputJoin(fmt.Sprintf("%s.%s", encoder, config.TheConfig.VideoExt))
		discord.Infof("Converting video: %s -> %s", job.Input, outputFile)
		args := []string{
			"-i", job.InputJoin(job.Input),
			"-o", outputFile,
			"--encoder", encoderCmd,
			"--vfr",
			"--quality", config.TheConfig.ConstantQuality,
			"--encoder-preset", encoderPreset,
			"--color-range", "auto",
			"--subtitle", "none",
			"--aencoder", "opus",
			"--ab", fmt.Sprintf("%d", config.TheConfig.AudioKbps),
			"--audio-lang-list", "any",
			"--all-audio",
			"--optimize", // web optimized
			"--mixdown", "stereo"}
		if encoderProfile != "" {
			args = append(args, "--encoder-profile", encoderProfile)
		}
		if encoderTune != "" {
			args = append(args, "--encoder-tune", encoderTune)
		}
		cmd := exec.Command(
			config.TheConfig.HandbrakeCli, args...)
		log.Infof("Command: %s", cmd.String())
		wg.Add(1)
		go func() {
			_, err := utils.RunCommand(cmd)
			if err == nil {
				job.EncodedCodecs = append(job.EncodedCodecs, encoder)
			}
			wg.Done()
		}()
	}
	for _, encoder := range encoders {
		switch encoder {
		case "av1":
			runEncoder(encoder, config.TheConfig.Av1Encoder, config.TheConfig.Av1Preset, "", "")
		case "hevc":
			runEncoder(encoder, config.TheConfig.HevcEncoder, config.TheConfig.HevcPreset, "", "")
		case "h264-10bit":
			runEncoder(encoder, config.TheConfig.H26410BitEncoder, config.TheConfig.H26410BitPreset, "", "")
		case "h264-8bit":
			runEncoder(encoder, config.TheConfig.H2648BitEncoder, config.TheConfig.H2648BitPreset, config.TheConfig.H2648BitProfile, config.TheConfig.H2648BitTune)
		default:
			return fmt.Errorf("unsupported encoder: %s", encoder)
		}
	}
	wg.Wait()
	return nil
}

func (job *Job) translateFlow() error {
	if len(config.TheConfig.TranslationLanguages) == 0 || !job.Translate {
		return nil
	}

	source := job.InputJoin(job.Input)
	translatable, err := ContainsSubtitles(source)
	if err != nil {
		return err
	}
	if !translatable {
		return fmt.Errorf("%s doesn't contain translatable subtitle", job.Input)
	}

	for _, languageWithCode := range config.TheConfig.TranslationLanguages {
		languageCode := strings.Split(languageWithCode, "/")[1]
		dest := job.OutputJoin(fmt.Sprintf("%s.ass", languageCode))

		translationRunProduct := job.InputJoin(utils.ReplaceExtension(job.Input, fmt.Sprintf(".%s.ass", languageCode)))
		if _, err := os.Stat(translationRunProduct); err == nil {
			discord.Infof("Copying translation product to encoder folder: %s -> %s", translationRunProduct, dest)
			if _, err := utils.CopyFile(translationRunProduct, dest); err != nil {
				return fmt.Errorf("error copying translation product: %v", err)
			}
			if err := translation.AssToVTT(dest); err != nil {
				return fmt.Errorf("unable to convert translation product from ass to vtt: %v", err)
			}
		}

		if _, err := translation.Translate(job.Input, job.OutputJoin(), source, dest, languageWithCode, true); err != nil {
			return fmt.Errorf("error translating: %v", err)
		}

		sourceDest := job.InputJoin(strings.ReplaceAll(job.Input, ".mkv",
			fmt.Sprintf(".%s.ass", languageCode)))
		discord.Infof("Copying encoder translation %s to %s", dest, sourceDest)
		if _, err := utils.CopyFile(dest, sourceDest); err != nil {
			return err
		}
	}

	return nil
}

func (job *Job) Pipeline() error {
	var err error
	job.SHA256, err = utils.CalculateFileSHA256(job.InputJoin(job.Input))
	if err != nil {
		return err
	}
	discord.Infof("Processing Job: %+v", job)
	err = os.MkdirAll(job.OutputJoin(), 0755)
	if err != nil {
		return err
	}
	err = os.WriteFile(job.OutputJoin(job.InputName()), []byte{}, 0644)
	err = job.updateState(Incomplete)
	if err != nil {
		return err
	}
	err = job.thumbnailsNfo()
	if err != nil {
		return err
	}
	_ = job.extractDominantColor()
	err = job.extractChapters()
	if err != nil {
		return err
	}
	err = job.ExtractStreams(job.InputJoin(job.Input), SubtitlesType)
	if err != nil {
		return err
	}
	err = job.translateFlow()
	if err != nil {
		return err
	}
	err = job.ExtractStreams(job.InputJoin(job.Input), AttachmentType)
	if err != nil {
		return err
	}
	err = job.updateState(StreamsExtracted)
	if err != nil {
		return err
	}
	if config.TheConfig.EnableEncode {
		startTime := time.Now()
		if job.Fast {
			err = job.ffmpegCopyOnly()
			if err != nil {
				return err
			}
		} else {
			err = job.handbrakeTranscode()
			if err != nil {
				return err
			}
		}
		if len(job.EncodedCodecs) > 0 {
			err = job.ExtractStreams(job.GetCodecVideo(job.EncodedCodecs[0]), AudioType)
			if err != nil {
				return err
			}
			if err := job.mapAudioTracks(); err != nil {
				return err
			}
			for _, audio := range job.Streams {
				if audio.CodecType == AudioType {
					err = os.Remove(job.OutputJoin(audio.Location))
					if err != nil {
						return fmt.Errorf("error removing file: %v", err)
					}
				}
			}
		}
		discord.Infof("Encode time cost: %s", time.Since(startTime))
	}
	if len(job.EncodedCodecs) > 0 {
		err = job.probe()
		if err != nil {
			return err
		}
	}
	err = job.updateState(Complete)
	if err != nil {
		return err
	}
	for _, codec := range job.EncodedCodecs {
		err = os.Remove(job.GetCodecVideo(codec))
	}
	return nil
}

func (job *Job) mapAudioTracks() error {
	job.MappedAudio = make(map[string][]Stream)
	for _, audio := range job.Streams {
		if audio.CodecType != AudioType {
			continue
		}
		for _, codec := range job.EncodedCodecs {
			id := fmt.Sprintf("%s-%d-%s", codec, audio.Index, audio.Language)
			cmd := exec.Command(config.TheConfig.Ffmpeg, "-i", job.GetCodecVideo(codec), "-i", job.OutputJoin(audio.Location),
				"-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", job.OutputJoin(fmt.Sprintf("%s.%s", id, config.TheConfig.VideoExt)))
			discord.Infof("Command: %s", cmd.String())
			_, err := utils.RunCommand(cmd)
			if err != nil {
				return fmt.Errorf("error mapping audio tracks: %v", err)
			}
			if _, ok := job.MappedAudio[codec]; !ok {
				job.MappedAudio[codec] = make([]Stream, 0)
			}
			job.MappedAudio[codec] = append(job.MappedAudio[codec], audio)
		}
	}
	return nil
}

func (job *Job) renameAndMove(source string, dest string) {
	source = job.InputJoin(source)
	dest = job.OutputJoin(dest)
	_, err := os.Stat(source)
	if err == nil {
		_, err = utils.CopyFile(source, dest)
		if err != nil {
			discord.Errorf("error copying file: %s->%s %v", source, dest, err)
		}
		discord.Infof("Moved %s to %s", source, dest)
	}
}

func (job *Job) thumbnailsNfo() (err error) {
	discord.Infof("Generating thumbnails and nfo files")
	job.renameAndMove("movie.nfo", "info.nfo")
	job.renameAndMove("tvshow.nfo", "info.nfo")
	job.renameAndMove(job.InputName()+".nfo", "info.nfo")
	job.renameAndMove(job.InputName()+"-thumb.jpg", "poster.jpg")
	job.renameAndMove("poster.jpg", "poster.jpg")
	job.renameAndMove("fanart.jpg", "fanart.jpg")
	return
}

func (job *Job) extractDominantColor() (err error) {
	f, err := os.Open(job.OutputJoin("poster.jpg"))
	defer func(f *os.File) {
		err := f.Close()
		if err != nil {
			discord.Errorf("error closing file: %v", err)
		}
	}(f)
	if err != nil {
		return fmt.Errorf("poster not found: " + job.OutputJoin("poster.jpg"))
	}
	img, _, err := image.Decode(f)
	if err != nil {
		return fmt.Errorf("error decoding image: %v", err)
	}
	color := dominantcolor.Hex(dominantcolor.Find(img))
	job.DominantColors = append(job.DominantColors, color)
	discord.Infof("Dominant color: %s", color)
	return nil
}

func (job *Job) updateDuration(videoFile string) error {
	out, err := utils.RunCommand(exec.Command(config.TheConfig.Ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoFile))
	if err != nil {
		discord.Errorf("Error getting video duration: %v\n", err)
	} else {
		job.Duration, _ = strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		discord.Infof("Container duration: %.2f", job.Duration)
	}

	actual, err := utils.RunCommand(exec.Command(
		config.TheConfig.Ffprobe,
		"-select_streams", "v:0",
		"-show_entries", "packet=pts_time",
		"-of", "csv=print_section=0",
		"-v", "quiet",
		videoFile,
	))
	if err != nil {
		discord.Errorf("Error getting video actual duration: %v\n", err)
	} else {
		split := strings.Split(strings.TrimSuffix(strings.TrimSpace(string(actual)), "\n"), "\n")
		if len(split) != 0 {
			actualFloat, _ := strconv.ParseFloat(strings.TrimSpace(split[len(split)-1]), 64)
			if actualFloat > 0 {
				job.Duration = actualFloat
				discord.Infof("Actual duration: %.2f", job.Duration)
			}
		}
	}
	if job.Duration == 0 {
		return fmt.Errorf("error getting video duration")
	}
	return nil
}

func (job *Job) probe() (err error) {
	vttFile := job.OutputJoin(ThumbnailVtt)
	videoFile := job.GetCodecVideo(job.EncodedCodecs[0])
	thumbnailHeight := config.TheConfig.ThumbnailHeight
	thumbnailInterval := config.TheConfig.ThumbnailInterval
	chunkInterval := config.TheConfig.ThumbnailChunkInterval
	err = job.updateDuration(videoFile)
	if err != nil {
		return
	}
	out, err := exec.Command(config.TheConfig.Ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", videoFile).Output()
	if err != nil {
		discord.Errorf("Error getting video aspect ratio: %v\n", err)
		return
	}
	aspectRatioStr := strings.TrimSpace(string(out))
	aspectRatioParts := strings.Split(aspectRatioStr, "x")
	job.Width, _ = strconv.Atoi(aspectRatioParts[0])
	job.Height, _ = strconv.Atoi(aspectRatioParts[1])
	aspectRatio := float64(job.Width) / float64(job.Height)
	discord.Infof("Width: %d, Height: %d, Duration: %f, Aspect Ratio: %f", job.Width, job.Height, job.Duration, aspectRatio)

	if !config.TheConfig.EnableSprite {
		return
	}

	numThumbnailsPerChunk := chunkInterval / thumbnailInterval
	numChunks := int(math.Ceil(job.Duration / float64(chunkInterval)))
	thumbnailWidth := int(math.Round(float64(thumbnailHeight) * aspectRatio))
	gridSize := int(math.Ceil(math.Sqrt(float64(numThumbnailsPerChunk))))

	vttContent := "WEBVTT\n\n"
	g, _ := errgroup.WithContext(context.Background())
	for i := 0; i < numChunks; i++ {
		g.Go(func() error {
			chunkStartTime := i * chunkInterval
			spriteFile := job.OutputJoin(fmt.Sprintf("%s_%d%s", SpritePrefix, i+1, SpriteExtension))
			cmd := exec.Command(config.TheConfig.Ffmpeg, "-i", videoFile, "-ss", fmt.Sprintf("%d", chunkStartTime), "-t", fmt.Sprintf("%d", chunkInterval),
				"-vf", fmt.Sprintf("fps=1/%d,scale=%d:%d,tile=%dx%d", thumbnailInterval, thumbnailWidth, thumbnailHeight, gridSize, gridSize), spriteFile)
			discord.Infof("Command: %s", cmd.String())
			_, err := utils.RunCommand(cmd)
			if err != nil {
				discord.Errorf("Error generating sprite sheet for chunk %d: %v\n", i+1, err)
				return err
			}
			return nil
		})
		for j := 0; j < numThumbnailsPerChunk; j++ {
			thumbnailTime := i*chunkInterval + j*thumbnailInterval
			startHour := thumbnailTime / 3600
			startMinute := (thumbnailTime % 3600) / 60
			startSecond := thumbnailTime % 60
			startTime := fmt.Sprintf("%02d:%02d:%02d.000", startHour, startMinute, startSecond)

			endThumbnailTime := thumbnailTime + thumbnailInterval
			endHour := endThumbnailTime / 3600
			endMinute := (endThumbnailTime % 3600) / 60
			endSecond := endThumbnailTime % 60
			endTime := fmt.Sprintf("%02d:%02d:%02d.000", endHour, endMinute, endSecond)

			row := j / gridSize
			col := j % gridSize
			thumbnailCoords := fmt.Sprintf("%d,%d,%d,%d", col*thumbnailWidth, row*thumbnailHeight, thumbnailWidth, thumbnailHeight)
			vttContent += fmt.Sprintf("%s --> %s\n%s#xywh=%s\n\n", startTime, endTime, fmt.Sprintf("%s_%d%s", SpritePrefix, i+1, SpriteExtension), thumbnailCoords)
		}
	}
	err = g.Wait()
	if err != nil {
		return
	}

	err = os.WriteFile(vttFile, []byte(vttContent), 0644)
	if err != nil {
		discord.Errorf("Error writing WebVTT file: %v\n", err)
		return
	}

	discord.Infof("Sprite sheets and WebVTT file generated successfully!")
	return
}

func (job *Job) updateState(newState string) error {
	job.State = newState
	jobStr, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("error persisting job: %v", err)
	}
	err = os.WriteFile(job.OutputJoin(JobFile), jobStr, 0644)
	if err != nil {
		return fmt.Errorf("error persisting job: %v", err)
	}
	return nil
}
