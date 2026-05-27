package translation

import (
	"Sparkle/discord"
	"Sparkle/utils"
	"fmt"
	"os"
	"strings"
	"time"
)

func (sub *ASSSubtitle) processIndex(inputPairSlice utils.PairSlice[string, int], out []string) (string, error) {
	output := utils.RemoveEmptyLinesAndTrimSpaces(out)
	if len(output) == 0 {
		return "", fmt.Errorf("subtitle contains no dialogues")
	}
	if len(inputPairSlice) != len(output) {
		return "", fmt.Errorf("subtitle line count mismatch with input: expected %d, got %d", len(inputPairSlice), len(output))
	}
	res := make([]string, len(output))
	sameInputAndOutput := 0
	for i := range output {
		inputLinePair := inputPairSlice[i]
		inputLine := inputLinePair.Left
		outputLine := output[i]
		inputParts := strings.SplitN(inputLine, ",", 2)
		outputParts := strings.SplitN(outputLine, ",", 2)
		if len(inputParts) != 2 || len(outputParts) != 2 {
			return "", fmt.Errorf("subtitle line has less commas than expected, input: %s, output: %s", inputLine, outputLine)
		}
		inputIndex := inputParts[0]
		outputIndex := outputParts[0]
		if inputIndex != outputIndex {
			return "", fmt.Errorf("subtitle index mismatch, input: %s, output: %s", inputLine, outputLine)
		}
		outputTextStr := strings.TrimSpace(outputParts[1])
		if len(outputTextStr) == 0 {
			return "", fmt.Errorf("subtitle dialogue line has no text: %s", outputLine)
		}
		inputTextStr := strings.TrimSpace(inputParts[1])
		if inputTextStr == outputTextStr {
			sameInputAndOutput++
		}
		oriInput := sub.dialogues[inputLinePair.Right]
		inputLineSplit := strings.Split(oriInput, ",")
		if len(inputLineSplit) <= sub.pos.Text {
			return "", fmt.Errorf("unable to find text field in input line: %s", inputLine)
		}
		res[i] = strings.Join(append(inputLineSplit[:sub.pos.Text], outputTextStr), ",")
	}
	// if 90% of lines are the same as input, and there are more than 130 lines, consider it a failure
	if len(output) >= 130 && float64(sameInputAndOutput)/float64(len(output)) > 0.9 {
		return "", fmt.Errorf("too many untranslated lines: %d/%d", sameInputAndOutput, len(output))
	}
	return strings.Join(res, "\n"), nil
}

func (sub *ASSSubtitle) process(inputPairSlice utils.PairSlice[string, int], out []string) (string, error) {
	output := utils.RemoveEmptyLinesAndTrimSpaces(out)
	if len(output) == 0 {
		return "", fmt.Errorf("subtitle contains no dialogues")
	}
	if len(inputPairSlice) != len(output) {
		return "", fmt.Errorf("subtitle line count mismatch with input: expected %d, got %d", len(inputPairSlice), len(output))
	}
	res := make([]string, len(output))
	lastLineCorrected := false
	for i := range output {
		currLineCorrected := false
		inputLinePair := inputPairSlice[i]
		inputLine := inputLinePair.Left
		outputLine := output[i]
		inputParts := strings.SplitN(inputLine, ",", 3)
		outputParts := strings.SplitN(outputLine, ",", 3)
		if len(inputParts) != 3 || len(outputParts) != 3 {
			return "", fmt.Errorf("subtitle line has less commas than expected, input: %s, output: %s", inputLine, outputLine)
		}
		inputStartTimeStr := inputParts[0]
		inputEndTimeStr := inputParts[1]
		_, err1 := time.Parse(utils.ASSTimeFormat, inputStartTimeStr)
		_, err2 := time.Parse(utils.ASSTimeFormat, inputEndTimeStr)
		if err1 != nil || err2 != nil {
			return "", fmt.Errorf("input subtitle time is malformed: %s", inputLine)
		}
		outputStartTimeStr := outputParts[0]
		outputEndTimeStr := outputParts[1]
		outputTextStr := strings.TrimSpace(outputParts[2])
		if len(outputTextStr) == 0 {
			return "", fmt.Errorf("subtitle dialogue line has no text: %s", outputLine)
		}
		_, err1 = time.Parse(utils.ASSTimeFormat, outputStartTimeStr)
		_, err2 = time.Parse(utils.ASSTimeFormat, outputEndTimeStr)
		if err1 != nil {
			if lastLineCorrected {
				discord.Infof("%s", inputLine)
				discord.Infof("%s", outputLine)
				return "", fmt.Errorf("consecutive subtitle time errors, unable to correct: %s", outputLine)
			}
			outputStartTimeStr = inputStartTimeStr
			discord.Infof("Corrected subtitle start time: %s -> %s", outputParts[0], outputStartTimeStr)
			currLineCorrected = true
		}
		if err2 != nil {
			if currLineCorrected || lastLineCorrected {
				discord.Infof("%s", inputLine)
				discord.Infof("%s", outputLine)
				return "", fmt.Errorf("consecutive subtitle time errors, unable to correct: %s", outputLine)
			}
			outputEndTimeStr = inputEndTimeStr
			discord.Infof("Corrected subtitle end time: %s -> %s", outputParts[1], outputEndTimeStr)
			currLineCorrected = true
		}
		if inputStartTimeStr != outputStartTimeStr {
			if currLineCorrected || lastLineCorrected {
				discord.Infof("%s", inputLine)
				discord.Infof("%s", outputLine)
				return "", fmt.Errorf("consecutive subtitle time errors, unable to correct: %s", outputLine)
			}
			outputStartTimeStr = inputStartTimeStr
			discord.Infof("Corrected subtitle start time: %s -> %s", outputParts[0], outputStartTimeStr)
			currLineCorrected = true
		}
		if inputEndTimeStr != outputEndTimeStr {
			if currLineCorrected || lastLineCorrected {
				discord.Infof("%s", inputLine)
				discord.Infof("%s", outputLine)
				return "", fmt.Errorf("consecutive subtitle time errors, unable to correct: %s", outputLine)
			}
			outputEndTimeStr = inputEndTimeStr
			discord.Infof("Corrected subtitle end time: %s -> %s", outputParts[1], outputEndTimeStr)
			currLineCorrected = true
		}

		lastLineCorrected = currLineCorrected

		oriInput := sub.dialogues[inputLinePair.Right]
		inputLineSplit := strings.Split(oriInput, ",")
		if len(inputLineSplit) <= sub.pos.Text {
			return "", fmt.Errorf("unable to find text field in input line: %s", inputLine)
		}
		res[i] = strings.Join(append(inputLineSplit[:sub.pos.Text], outputTextStr), ",")
	}
	return strings.Join(res, "\n"), nil
}

func isASSFileValid(filePath string) error {
	// Read the content of the .ass file
	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	sub, err := sanitizeInputASS(string(content))
	if err != nil {
		return err
	}
	if len(sub.dialogues) < 2 {
		fmt.Printf("subtitle doesn't contain any dialogue (%d lines): %s\n", len(sub.dialogues), filePath)
		return nil
	}
	normalizedOutput := utils.RemoveEmptyLinesAndTrimSpaces(sub.dialogues)
	if len(normalizedOutput) == 0 {
		return fmt.Errorf("subtitle contains no dialogues")
	}
	for _, line := range normalizedOutput {
		commas := strings.Count(line, ",")
		if commas < sub.pos.TotalCommas {
			return fmt.Errorf("subtitle contains less commas than format line: %s, expected: %d, got: %d",
				line, sub.pos.TotalCommas, commas)
		}
		textStr := strings.TrimSpace(extractDialogueField(line, sub.pos.Text, true))
		if len(textStr) == 0 {
			return fmt.Errorf("subtitle dialogue line has no text: %s", line)
		}
	}
	return nil
}
