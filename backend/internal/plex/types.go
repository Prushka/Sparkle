package plex

import "encoding/json"

// Plex uses a number for section IDs in metadata and a string in section lists.
func sectionID(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	if digits.Match(raw) {
		return string(raw)
	}
	return ""
}

func (m *Metadata) UnmarshalJSON(data []byte) error {
	type plain Metadata
	v := struct {
		*plain
		Section json.RawMessage `json:"librarySectionID"`
	}{plain: (*plain)(m)}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	m.SectionID = sectionID(v.Section)
	return nil
}

func (c *Container) UnmarshalJSON(data []byte) error {
	type plain Container
	v := struct {
		*plain
		Section json.RawMessage `json:"librarySectionID"`
	}{plain: (*plain)(c)}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	c.SectionID = sectionID(v.Section)
	return nil
}

type Response struct {
	Container Container `json:"MediaContainer"`
}
type Container struct {
	MachineIdentifier string     `json:"machineIdentifier"`
	SectionID         string     `json:"librarySectionID"`
	Offset            int        `json:"offset"`
	TotalSize         int        `json:"totalSize"`
	Metadata          []Metadata `json:"Metadata"`
	Sections          []Section  `json:"Directory"`
}
type Section struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Type  string `json:"type"`
}
type Metadata struct {
	Key              string    `json:"ratingKey"`
	SectionID        string    `json:"librarySectionID"`
	Type             string    `json:"type"`
	Title            string    `json:"title"`
	SortTitle        string    `json:"titleSort"`
	Summary          string    `json:"summary"`
	Thumb            string    `json:"thumb"`
	Art              string    `json:"art"`
	ParentThumb      string    `json:"parentThumb"`
	ParentKey        string    `json:"parentRatingKey"`
	GrandparentKey   string    `json:"grandparentRatingKey"`
	GrandparentTitle string    `json:"grandparentTitle"`
	Index            int       `json:"index"`
	ParentIndex      int       `json:"parentIndex"`
	Year             int       `json:"year"`
	AddedAt          int64     `json:"addedAt"`
	Duration         float64   `json:"duration"`
	ChildCount       int       `json:"childCount"`
	Media            []Media   `json:"Media"`
	Chapters         []Chapter `json:"Chapter"`
}
type Media struct {
	ID         int64   `json:"id"`
	Container  string  `json:"container"`
	VideoCodec string  `json:"videoCodec"`
	AudioCodec string  `json:"audioCodec"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	Duration   float64 `json:"duration"`
	Parts      []Part  `json:"Part"`
}
type Part struct {
	ID       int64    `json:"id"`
	File     string   `json:"file"`
	Size     int64    `json:"size"`
	Duration float64  `json:"duration"`
	Streams  []Stream `json:"Stream"`
}
type Stream struct {
	ID             int64  `json:"id"`
	Index          int    `json:"index"`
	Type           int    `json:"streamType"`
	Codec          string `json:"codec"`
	Language       string `json:"language"`
	LanguageCode   string `json:"languageCode"`
	Title          string `json:"title"`
	DisplayTitle   string `json:"displayTitle"`
	Default        bool   `json:"default"`
	Forced         bool   `json:"forced"`
	Channels       int    `json:"channels"`
	BitDepth       int    `json:"bitDepth"`
	ColorPrimaries string `json:"colorPrimaries"`
	ColorSpace     string `json:"colorSpace"`
	ColorRange     string `json:"colorRange"`
	ColorTransfer  string `json:"colorTrc"`
	DOVIPresent    bool   `json:"DOVIPresent"`
	DOVIProfile    int    `json:"DOVIProfile"`
	DOVILevel      int    `json:"DOVILevel"`
	DOVIBLCompatID int    `json:"DOVIBLCompatID"`
	DOVIELPresent  bool   `json:"DOVIELPresent"`
	HDR10Plus      bool   `json:"HDR10PlusPresent"`
}
type Chapter struct {
	Index int     `json:"index"`
	Title string  `json:"title"`
	Start float64 `json:"startTimeOffset"`
	End   float64 `json:"endTimeOffset"`
}
