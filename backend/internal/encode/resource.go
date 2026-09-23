package encode

import (
	"regexp"
	"strconv"
	"strings"
)

var segmentResource = regexp.MustCompile(`^(video|audio|subtitles)-([0-9]{1,6})\.(m4s|json)$`)

func parseResource(resource string) (string, int, bool) {
	if strings.HasSuffix(resource, "-init.mp4") {
		return strings.TrimSuffix(resource, "-init.mp4"), 0, true
	}
	m := segmentResource.FindStringSubmatch(resource)
	if m == nil {
		return "", -1, false
	}
	if (m[1] == "subtitles") != (m[3] == "json") {
		return "", -1, false
	}
	n, err := strconv.Atoi(m[2])
	if err != nil {
		return "", -1, false
	}
	return m[1], n, false
}
