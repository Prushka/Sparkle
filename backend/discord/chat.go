package discord

import (
	"Sparkle/config"
	"os"
)

type Chat struct {
	Message   string  `json:"message"`
	Timestamp int64   `json:"timestamp"`
	MediaSec  float64 `json:"mediaSec"`
	Uid       string  `json:"uid"`
}

func Webhook(chat string, name string, id string) {
	avatarUrl := config.TheConfig.Host + "/static/pfp/" + id + ".png"
	_, err := os.Stat(config.TheConfig.Output + "/pfp/" + id + ".png")
	message := MessagePayload{
		Username:    &name,
		Content:     &chat,
		WebhookType: ChatWebhook,
	}
	if err == nil {
		message.AvatarUrl = &avatarUrl
	}
	Send(message)
}
