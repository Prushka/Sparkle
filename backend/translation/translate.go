package translation

import (
	"Sparkle/ai"
	"Sparkle/config"
	"Sparkle/discord"
	"Sparkle/utils"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func findInputLang(languages map[string]*ASSSubtitle) (*ASSSubtitle, string) {
	for _, chosenLanguage := range config.TheConfig.TranslationInputLanguage {
		if elem, ok := languages[chosenLanguage]; ok {
			discord.Infof("Using language: %s", chosenLanguage)
			return elem, chosenLanguage
		}
	}
	for key, value := range languages {
		discord.Infof("Using language: %s", key)
		return value, key
	}
	return nil, ""
}

func Translate(media, inputDir, mediaFile, dest, languageWithCode string, convertToVTT bool) (int, error) {
	before := time.Now()
	ss := strings.Split(languageWithCode, "/")
	language := ss[0]
	languageCode := ss[1]

	stat, err := os.Stat(dest)
	statInput, _ := os.Stat(mediaFile)
	if err == nil && statInput.ModTime().Before(stat.ModTime()) {
		discord.Infof("SKIPPING: File already exists: %s", dest)
		return 0, nil
	}
	files, err := os.ReadDir(inputDir)
	if err != nil {
		return 0, err
	}
	langLengths := make(map[string]int)
	languages := make(map[string]*ASSSubtitle)
	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".ass") && strings.Contains(file.Name(), "-") {
			var lang string
			source := filepath.Join(inputDir, file.Name())
			if len(file.Name()) >= 7 {
				lang = strings.ToLower(file.Name()[len(file.Name())-7 : len(file.Name())-4])
				if lang == strings.ToLower(languageCode) {
					discord.Infof("SKIPPING: Subtitle with language %s already exists in job folder: %s",
						language,
						dest)
					_, err = utils.CopyFile(source, dest)
					return 0, err
				}
			} else {
				// when language is unknown, subtitle becomes format: 3-.ext
				lang = "unknown"
				discord.Infof("Subtitle with unknown language, proceeding: %s", source)
			}
			fBytes, err := os.ReadFile(source)
			if err != nil {
				discord.Errorf("Error reading file: %v", err)
				continue
			}
			subtitles := string(fBytes)
			sub, err := sanitizeInputASS(subtitles)
			if err != nil {
				discord.Errorf("Error sanitizing input ass: %v", err)
				continue
			}
			fLines := strings.Split(subtitles, "\n")
			if prev, ok := langLengths[lang]; !ok || prev < len(fLines) {
				langLengths[lang] = len(fLines)
				languages[lang] = sub
			}
		}
	}
	discord.Infof("%v", langLengths)
	if len(languages) == 0 {
		return 0, fmt.Errorf("unable to find any .ass subtitle")
	}
	chosenSub, chosenLanguage := findInputLang(languages)
	translated, attempts, err := TranslateSubtitlesASS(chosenSub,
		language, config.GetSystemMessage(chosenLanguage, language, media))
	if err != nil {
		return attempts, err
	}
	translated = chosenSub.sanitizeOutput(translated)

	dest = strings.ReplaceAll(dest, "{attempts}", fmt.Sprintf("%d", attempts))
	dest = strings.ReplaceAll(dest, "{duration}", fmt.Sprintf("%s", time.Since(before).String()))

	err = os.WriteFile(dest, []byte(translated), 0755)
	if err != nil {
		return attempts, err
	}

	if convertToVTT {
		err = AssToVTT(dest)
		if err != nil {
			return attempts, err
		}
	}

	discord.Infof("Translated (%d attempts): %s", attempts, dest)
	return attempts, nil
}

func TranslateSubtitlesASS(sub *ASSSubtitle, language, systemMessage string) (string, int, error) {
	discord.Infof("[ASS] Translating to language: %s", language)

	ctx := context.Background()
	processor := func(inputPairSlice utils.PairSlice[string, int], output string) (string, error) {
		t := strings.Split(output, "\n")
		outputLinesCount := len(t)
		discord.Infof("Output length: %d, Output lines: %d, Input lines: %d",
			len(strings.Join(t, "\n")),
			outputLinesCount, len(inputPairSlice))
		post, err := sub.processIndex(inputPairSlice, t)
		if err != nil {
			return "", err
		}
		return post, nil
	}
	translated, attempts, err := ai.SendWithRetrySplit(
		ctx,
		systemMessage,
		sub.distilledDialoguesWithIndex,
		processor, config.TheConfig.AIForceFallback)
	if !config.TheConfig.AIForceFallback && ai.IsErrorProhibitedContent(err) {
		discord.Infof("Using fallback client due to prohibited content")
		translated, attempts, err = ai.SendWithRetrySplit(
			ctx,
			systemMessage,
			sub.distilledDialoguesWithIndex,
			processor, true)
		if err != nil {
			return "", attempts, err
		}
	} else if err != nil {
		return "", attempts, err
	}
	if len(translated) == 0 {
		return "", attempts, fmt.Errorf("unable to find any translation results")
	}
	return strings.Join(translated, "\n"), attempts, nil
}
