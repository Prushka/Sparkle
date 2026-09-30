package plex

import (
	"encoding/json"
	"errors"
	"strings"
)

// parseMappings accepts JSON plus pasted absolute Windows paths. The first
// separator distinguishes a literal drive path (C:\media) from an escaped JSON
// path (C:\\media); UNC paths start with two or four backslashes respectively.
// Treat every separator in a literal path alike, including \b, \t and \u, so
// directory names cannot silently become JSON control characters or Unicode.
func parseMappings(raw string) ([]Mapping, error) {
	invalid := errors.New("PLEX_PATH_MAPPINGS must be a nonempty JSON array of path mappings")
	var normalized strings.Builder
	for i := 0; i < len(raw); i++ {
		if raw[i] != '"' {
			normalized.WriteByte(raw[i])
			continue
		}
		start := i + 1
		literal := literalWindowsPath(raw[start:])
		end := start
		for end < len(raw) && raw[end] != '"' {
			if raw[end] < 0x20 {
				return nil, invalid
			}
			if !literal && raw[end] == '\\' {
				end++
			}
			end++
		}
		if end >= len(raw) {
			return nil, invalid
		}
		if literal {
			quoted, _ := json.Marshal(raw[start:end])
			normalized.Write(quoted)
		} else {
			normalized.WriteString(raw[i : end+1])
		}
		i = end
	}
	var mappings []Mapping
	if json.Unmarshal([]byte(normalized.String()), &mappings) != nil || len(mappings) == 0 {
		return nil, invalid
	}
	return mappings, nil
}

func literalWindowsPath(value string) bool {
	if len(value) >= 3 && ((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) && value[1] == ':' && value[2] == '\\' {
		return len(value) == 3 || value[3] != '\\'
	}
	return strings.HasPrefix(value, `\\`) && !strings.HasPrefix(value, `\\\\`)
}
