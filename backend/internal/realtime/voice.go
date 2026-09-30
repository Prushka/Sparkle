package realtime

import (
	"math"
	"strings"
)

// Only voice presence is room-wide. SDP and ICE must address one room participant.
// Reconstruct the payload so malformed browser input cannot become a room broadcast.
func sanitizeVoiceBroadcast(raw map[string]any) map[string]any {
	signal, ok := raw["signal"].(map[string]any)
	if !ok {
		return nil
	}
	session, ok := signal["sessionId"].(string)
	if !ok || !safeID.MatchString(session) {
		return nil
	}
	kind, ok := signal["kind"].(string)
	if !ok {
		return nil
	}
	clean := map[string]any{"kind": kind, "sessionId": session}
	result := map[string]any{"type": "voiceSignal", "signal": clean}
	target, hasTarget := raw["targetId"]
	if hasTarget {
		id, ok := target.(string)
		if !ok || !safeID.MatchString(strings.TrimSpace(id)) {
			return nil
		}
		result["targetId"] = strings.TrimSpace(id)
	}
	if targetSession, exists := signal["targetSessionId"]; exists {
		id, ok := targetSession.(string)
		if !ok || !safeID.MatchString(id) {
			return nil
		}
		clean["targetSessionId"] = id
	}
	if muted, ok := signal["muted"].(bool); ok {
		clean["muted"] = muted
	}
	switch kind {
	case "hello", "status":
		if _, ok := clean["muted"]; !ok {
			return nil
		}
	case "leave":
	case "offer", "answer":
		if !hasTarget {
			return nil
		}
		description, ok := signal["description"].(map[string]any)
		if !ok || description["type"] != kind {
			return nil
		}
		sdp, ok := description["sdp"].(string)
		if !ok || len(sdp) == 0 || len(sdp) > 48*1024 {
			return nil
		}
		clean["description"] = map[string]any{"type": kind, "sdp": sdp}
	case "ice":
		if !hasTarget {
			return nil
		}
		candidate, ok := signal["candidate"].(map[string]any)
		if !ok {
			return nil
		}
		value, ok := candidate["candidate"].(string)
		if !ok || len(value) > 4096 {
			return nil
		}
		ice := map[string]any{"candidate": value}
		for _, key := range []string{"sdpMid", "usernameFragment"} {
			if v, exists := candidate[key]; exists && v != nil {
				text, ok := v.(string)
				if !ok || len(text) > 256 {
					return nil
				}
				ice[key] = text
			}
		}
		if v, exists := candidate["sdpMLineIndex"]; exists && v != nil {
			n, ok := v.(float64)
			if !ok || math.IsNaN(n) || n < 0 || n > 65535 || n != math.Trunc(n) {
				return nil
			}
			ice["sdpMLineIndex"] = n
		}
		if value != "" && ice["sdpMid"] == nil && ice["sdpMLineIndex"] == nil {
			return nil
		}
		clean["candidate"] = ice
	default:
		return nil
	}
	return result
}
