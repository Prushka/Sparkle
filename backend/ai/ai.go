package ai

import (
	"Sparkle/config"
	"Sparkle/discord"
	"Sparkle/utils"
	"context"
	"fmt"
	"strings"
	"time"
)

type AI interface {
	StartChat(systemInstruction string) error
	Send(ctx context.Context, input string) (Result, error)
	GetLastExhausted() time.Time
	SetLastExhausted()
	ClearPreviousRun()
}

type Result interface {
	Usage() interface{}
	Text() string
	Response() interface{}
}

var OpenAIClis []AI
var FallbackAICli AI

func Init() {
	discord.Infof("Initializing AI clients")
	if len(config.TheConfig.AIKeys) > 0 {
		discord.Infof("Initializing %d AI clients", len(config.TheConfig.AIKeys))
		for _, key := range config.TheConfig.AIKeys {
			OpenAIClis = append(OpenAIClis, NewOpenAI(config.TheConfig.AIUrl, config.TheConfig.AIModel, key, config.TheConfig.HistoryCount, config.TheConfig.AIIsLocal))
		}
	} else if config.TheConfig.AIUrl != "" {
		discord.Infof("No OpenAI keys found, found custom url, initializing without key for custom url")
		OpenAIClis = append(OpenAIClis, NewOpenAI(config.TheConfig.AIUrl, config.TheConfig.AIModel, "", config.TheConfig.HistoryCount, config.TheConfig.AIIsLocal))
	}
	if config.TheConfig.FallbackAIUrl != "" && config.TheConfig.FallbackAIModel != "" {
		FallbackAICli = NewOpenAI(config.TheConfig.FallbackAIUrl, config.TheConfig.FallbackAIModel, "", config.TheConfig.FallbackHistoryCount, config.TheConfig.FallbackAIIsLocal)
	}
}

func splitByCharacters(lines []string, atChar int) []utils.PairSlice[string, int] {
	var (
		result       []utils.PairSlice[string, int]
		currentLines utils.PairSlice[string, int]
		count        int
	)

	for i, line := range lines {
		currentLines = append(currentLines, utils.Pair[string, int]{Left: line, Right: i})
		count += len(line)
		if count >= atChar {
			result = append(result, currentLines)
			currentLines = nil
			count = 0
		}
	}

	if len(currentLines) > 0 {
		result = append(result, currentLines)
	}

	return result
}

func SendWithRetrySplit(ctx context.Context, systemMessage string,
	distilledDialoguesWithIndex []string,
	processor func(inputPairSlice utils.PairSlice[string, int], output string) (string, error), isFallback bool) ([]string, int, error) {
	batchLength := config.TheConfig.TranslationBatchLength
	if isFallback {
		batchLength = config.TheConfig.FallbackTranslationBatchLength
	}
	inputPairSlices := splitByCharacters(distilledDialoguesWithIndex, batchLength)
	totalAttempts := 0
	run := func(a AI) ([]string, error) {
		defaultLimit := 360000 / batchLength
		if len(inputPairSlices) > defaultLimit {
			return nil, fmt.Errorf("too many split segments: %d/%d", len(inputPairSlices), defaultLimit)
		}

		var translated []string

		if err := a.StartChat(systemMessage); err != nil {
			return nil, err
		}
		for idx, inputSlice := range inputPairSlices {
			discord.Infof("Processing index: %d/%d",
				idx+1, len(inputPairSlices))
			if config.TheConfig.Debug {
				fmt.Println(strings.Join(inputSlice.LeftSlice(), "\n"))
			}
			result, attempts, err := SendWithRetry(ctx, a, strings.Join(inputSlice.LeftSlice(), "\n"),
				func(output string) (string, error) {
					processed, err := processor(inputSlice, output)
					return processed, err
				})
			totalAttempts += attempts
			if err != nil {
				return nil, err
			}
			translated = append(translated, result)
		}
		return translated, nil
	}

	if isFallback {
		if FallbackAICli == nil {
			return nil, 0, fmt.Errorf("fallback AI client not initialized")
		}
		var res []string
		res, err := run(FallbackAICli)
		if err == nil {
			return res, totalAttempts, nil
		}
		discord.Errorf("Fallback client failed with error: %+v", err)
		return nil, totalAttempts, fmt.Errorf("fallback client failed")
	}
	exhausted := 0
	for i, runner := range OpenAIClis {
		if time.Since(runner.GetLastExhausted()) < config.TheConfig.SleepAfterExhausted {
			exhausted++
			continue
		}
		discord.Infof("Running on client: %d", i)
		var res []string
		res, err := run(runner)
		if err == nil {
			return res, totalAttempts, nil
		}
		discord.Errorf("Client %d failed with error: %+v", i, err)
		if IsErrorExhausted(err) {
			exhausted++
			runner.SetLastExhausted()
		}
		if IsErrorProhibitedContent(err) {
			discord.Errorf("Detected prohibited content...")
			return nil, totalAttempts, err
		}
	}
	if exhausted == len(OpenAIClis) {
		discord.Errorf("All clients exhausted, sleeping for %v", config.TheConfig.SleepAfterExhausted)
		time.Sleep(config.TheConfig.SleepAfterExhausted)
	}
	return nil, totalAttempts, fmt.Errorf("all clients failed or exhausted")
}

func SendWithRetry(ctx context.Context, a AI, input string, processor func(output string) (string, error)) (string, int, error) {
	var err error
	attempts := config.TheConfig.TranslationAttempts
	for i := 1; i < attempts+1; i++ {
		discord.Infof("Attempt: %d", i)
		result, err := a.Send(ctx, input)
		if err != nil {
			discord.Errorf("Error on attempt %d: %v", i, err)
			if result != nil && result.Response() != nil && utils.AsJson(result.Response()) != "null" {
				fmt.Println(utils.AsJson(result.Response()))
			}
			if IsErrorExhausted(err) || IsErrorProhibitedContent(err) {
				return "", i, err
			}
		} else {
			processed, err := processor(result.Text())
			if err == nil {
				return processed, i, nil
			} else {
				a.ClearPreviousRun() // only runs when ai succeeds but processing fails
				discord.Errorf("Attempt %d: %v", i, err)
			}
		}
	}
	return "", attempts, fmt.Errorf("failed after %d attempts | %v", attempts, err)
}
