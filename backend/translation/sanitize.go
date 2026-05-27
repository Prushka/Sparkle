package translation

import (
	"strings"
)

// removeSingleFullStops replace any lone [char] with space while preserving contiguous runs of [char]
func removeSingleFullStops(input string, char rune) string {
	var b strings.Builder
	runes := []rune(input)

	for i := 0; i < len(runes); {
		if runes[i] == char {
			// count how many consecutive [char] we have
			j := i + 1
			for j < len(runes) && runes[j] == char {
				j++
			}
			count := j - i

			// if it's a run of 2 or more, write them; otherwise write a space
			if count > 1 {
				b.WriteString(string(runes[i:j]))
			} else {
				b.WriteString(" ")
			}
			i = j
		} else {
			b.WriteRune(runes[i])
			i++
		}
	}

	return b.String()
}

// TODO: context aware seasons
