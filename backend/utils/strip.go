package utils

import (
	"regexp"
	"strings"
	"time"
)

const ASSTimeFormat = "15:04:05.00"

// KeepOnlySubtitles removes any non-desired content from the input string,
// it also removes anything that's not a subtitle line
func KeepOnlySubtitles(input string) string {
	inputLines := RemoveEmptyLinesAndTrimSpaces(strings.Split(input, "\n"))
	var outputLines []string
	for _, line := range inputLines {
		if StartsWithIndex(line) {
			outputLines = append(outputLines, line)
		}
	}
	return strings.Join(outputLines, "\n")
}

var IndexPrefix = regexp.MustCompile(`^\d+,`)

// StartsWithIndex checks if the input string starts with an integer index followed by a comma
func StartsWithIndex(s string) bool {
	return IndexPrefix.MatchString(s)
}

// HasValidTime checks if the input string has a prefix
// that can be parsed by ASSTimeFormat.
func HasValidTime(s string) bool {
	split := strings.SplitN(s, ",", 3)
	if len(split) < 3 {
		return false
	}
	start := split[0]
	end := split[1]
	_, errStart := time.Parse(ASSTimeFormat, start)
	_, errEnd := time.Parse(ASSTimeFormat, end)
	return errStart == nil || errEnd == nil // at least one of them should be valid to be corrected
}

func RemoveEmptyLinesAndTrimSpaces(block []string) []string {
	var nonEmptyLines []string
	for _, line := range block {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			nonEmptyLines = append(nonEmptyLines, trimmed)
		}
	}
	return nonEmptyLines
}
