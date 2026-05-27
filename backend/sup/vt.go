package sup

import (
	"Sparkle/config"
	"slices"
	"strings"
)

type VT map[string][]string

func (vt VT) resultByLastModel() string {
	for key, values := range vt {
		if slices.Contains(values, config.TheConfig.OCRVLMModels[len(config.TheConfig.OCRVLMModels)-1]) {
			return key
		}
	}
	return ""
}

func (vt VT) majorityVote() (string, bool) {
	var mostVoted string
	maxVotes := 0
	for key, votes := range vt {
		if len(votes) > maxVotes {
			maxVotes = len(votes)
			mostVoted = key
		}
	}
	if maxVotes >= config.TheConfig.OCRVLMVotes {
		return mostVoted, true
	}
	return "", false
}

// converge returns a new VT map where entries with keys that are equal when ignoring new lines and spaces are converged.
// For any equal entries, it keeps the one with the most new line characters. In case of a tie, it keeps the one with the most spaces.
func (vt VT) converge() VT {
	result := make(VT)
	normalizedKeys := make(map[string]string)

	for key, value := range vt {
		normalizedKey := normalize(key)

		if existingKey, ok := normalizedKeys[normalizedKey]; ok {
			// A key with the same normalized form exists, decide which one to keep.
			if shouldReplace(key, existingKey) {
				oldVal := result[existingKey]
				delete(result, existingKey)
				result[key] = append(oldVal, value...)
				normalizedKeys[normalizedKey] = key
			} else {
				result[existingKey] = append(result[existingKey], value...)
			}
		} else {
			// This is the first time we see this normalized key.
			result[key] = value
			normalizedKeys[normalizedKey] = key
		}
	}

	return result
}

// normalize removes new lines and spaces from a string.
func normalize(s string) string {
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, " ", "")
	return s
}

// shouldReplace determines if the newKey should replace the oldKey based on the convergence criteria.
func shouldReplace(newKey, oldKey string) bool {
	newNewlines := strings.Count(newKey, "\n")
	oldNewlines := strings.Count(oldKey, "\n")

	if newNewlines > oldNewlines {
		return true
	}
	if newNewlines < oldNewlines {
		return false
	}

	// If newline counts are equal, compare space counts.
	newSpaces := strings.Count(newKey, " ")
	oldSpaces := strings.Count(oldKey, " ")

	return newSpaces > oldSpaces
}
