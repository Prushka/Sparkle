package sup

import (
	"Sparkle/config"
	"Sparkle/discord"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"regexp"
	"strings"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/packages/param"
	log "github.com/sirupsen/logrus"
)

const (
	systemPrompt = `You are a specialized OCR Subtitle Extractor. Your sole function is to transcribe the text from an input image with absolute precision.
Input: A single image containing subtitles.
Task:
1.  Transcribe the text with 100% accuracy, matching the source exactly, WITHOUT modification.
2.  Preserve the original structure, preserve all line breaks, do not omit anything.
Output: A plain text transcription of the subtitle. There should be no markdown, no comments, and no additional content other than the text extracted from the image.`

	temperature = 0.1
)

type ImageSubtitle struct {
	Image     image.Image
	StartTime time.Duration
	EndTime   time.Duration
}

type Voting struct {
	Start VTTTimestamp
	End   VTTTimestamp
	Texts VT
}

var replacer = strings.NewReplacer(
	"’", "'",
	"“", "\"",
	"”", "\"",
	"‘", "'",
	"—", "-",
	"–", "-",
	"…", "...",
	" ", " ", // non-breaking space to regular space
	string(rune(0)), "", // remove null characters
	"\r", "", // remove carriage returns
)

// This regular expression matches two or more consecutive newline characters.
// It handles both \n (Unix-style) and \r\n (Windows-style) newlines.
var newLineRegex = regexp.MustCompile(`(\r?\n){2,}`)

// replaceTargetedDoubleDashes replaces "--" with "-" at the beginning and end of any new line.
// It ignores sequences of more than two dashes and dashes in the middle of a line.
func replaceTargetedDoubleDashes(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		processedLine := line
		if strings.HasPrefix(processedLine, "--") && !strings.HasPrefix(processedLine, "---") {
			processedLine = "-" + processedLine[2:]
		}

		if strings.HasSuffix(processedLine, "--") && !strings.HasSuffix(processedLine, "---") {
			processedLine = processedLine[:len(processedLine)-2] + "-"
		}
		lines[i] = processedLine
	}
	return strings.Join(lines, "\n")
}

func lightProcess(input string) string {
	return newLineRegex.ReplaceAllString(replaceTargetedDoubleDashes(replacer.Replace(input)), "\n")
}

func OCR(imgSubs []ImageSubtitle) (VTTSubtitles, error) {
	totalPromptTokens := make(map[string]int64)
	totalCompletionTokens := make(map[string]int64)
	txtSubs := make([]*Voting, len(imgSubs))
	defer func() {
		discord.Infof("prompt=%v, completion=%v", totalPromptTokens, totalCompletionTokens)
	}()
	for index, pg := range imgSubs {
		imgSubs[index].Image = TrimTransparentColumns(TrimTransparentRows(pg.Image))
		//save := func() {
		//	if !config.TheConfig.Debug {
		//		return
		//	}
		//	fname := fmt.Sprintf("debug/%03d.png", index+1)
		//	f, err := os.Create(fname)
		//	if err != nil {
		//		log.Errorf("failed to create debug image file: %v", err)
		//	}
		//	defer func(f *os.File) {
		//		err := f.Close()
		//		if err != nil {
		//			log.Errorf("failed to close debug image file: %v", err)
		//		}
		//	}(f)
		//	err = png.Encode(f, imgSubs[index].Image)
		//	if err != nil {
		//		log.Errorf("failed to encode debug image to file: %v", err)
		//	}
		//}
	}
	for _, model := range config.TheConfig.OCRVLMModels {
		discord.Infof("Starting OCR with model: %s", model)
		for index, pg := range imgSubs {
			if txtSubs[index] != nil {
				if t, ok := txtSubs[index].Texts.majorityVote(); ok {
					log.Debugf("Skipping already decided subtitle #%d %v", index+1, t)
					continue
				} else {
					log.Debugf("Continuing undecided subtitle #%d %v", index+1, txtSubs[index].Texts)
				}
			}
			text, promptTokens, completionTokens, err := ExtractText(model, pg.Image)
			if err != nil {
				log.Errorf("failed to extract text from image #%d: %s", index+1, err)
			} else {
				text = lightProcess(text)
				totalPromptTokens[model] += promptTokens
				totalCompletionTokens[model] += completionTokens

				log.Debugf("%s #%d %s --> %s %s, %d -> %d", model, index+1, pg.StartTime, pg.EndTime, text, promptTokens, completionTokens)
				if txtSubs[index] == nil {
					txtSubs[index] = &Voting{
						Start: VTTTimestamp(pg.StartTime),
						End:   VTTTimestamp(pg.EndTime),
						Texts: VT{},
					}
				}
				txtSubs[index].Texts[text] = append(txtSubs[index].Texts[text], model)
				txtSubs[index].Texts = txtSubs[index].Texts.converge()
			}
		}
	}
	results := make(VTTSubtitles, len(imgSubs))
	for i, v := range txtSubs {
		if v == nil || len(v.Texts) == 0 {
			return nil, fmt.Errorf("failed to extract VTT subtitle #%d contains no subtitle", i)
		}
		if t, ok := v.Texts.majorityVote(); ok {
			results[i] = VTTSubtitle{
				Start: v.Start,
				End:   v.End,
				Text:  t,
			}
		} else {
			log.Warnf("OCR subtitle has no majority votes %v", v)
			results[i] = VTTSubtitle{
				Start: v.Start,
				End:   v.End,
				Text:  v.Texts.resultByLastModel(),
			}
			log.Warnf("Using last model result: %s", results[i].Text)
		}
	}
	return results, nil
}

func ExtractText(model string, img image.Image) (text string, promptTokens, completionTokens int64, err error) {
	encodedImage, err := encodeImageToDataURL(img)
	if err != nil {
		err = fmt.Errorf("failed to encode image: %w", err)
		return
	}
	messages := []openai.ChatCompletionMessageParamUnion{
		openai.SystemMessage(systemPrompt),
		openai.UserMessage([]openai.ChatCompletionContentPartUnionParam{
			{
				OfImageURL: &openai.ChatCompletionContentPartImageParam{
					ImageURL: openai.ChatCompletionContentPartImageImageURLParam{
						URL: encodedImage,
					},
				},
			},
		}),
	}
	ctx, cancel := context.WithTimeout(context.Background(), openaiTimeout)
	defer cancel()
	chatCompletion, err := oaiClient.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: model,
		Temperature: param.Opt[float64]{
			Value: temperature,
		},
		Messages: messages,
	})
	if err != nil {
		err = fmt.Errorf("failed to get OCR chat completion: %w", err)
		return
	}
	if chatCompletion == nil || len(chatCompletion.Choices) == 0 {
		err = fmt.Errorf("no choices returned from OCR chat completion")
		return
	}
	text = chatCompletion.Choices[0].Message.Content
	promptTokens = chatCompletion.Usage.PromptTokens
	completionTokens = chatCompletion.Usage.CompletionTokens
	return
}

func encodeImageToDataURL(image image.Image) (string, error) {
	var data bytes.Buffer
	err := png.Encode(&data, image)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("data:image/png;base64,%s", base64.StdEncoding.EncodeToString(data.Bytes())), nil
}
