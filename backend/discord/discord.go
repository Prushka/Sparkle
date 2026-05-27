package discord

import (
	"Sparkle/cleanup"
	"Sparkle/config"
	"encoding/json"
	"fmt"
	mapset "github.com/deckarep/golang-set/v2"
	"github.com/go-co-op/gocron"
	"github.com/gtuk/discordwebhook"
	log "github.com/sirupsen/logrus"
	"os"
	"sync"
	"time"
)

type MessagePayload struct {
	Content     *string `json:"content"`
	WebhookType int     `json:"webhookType"`
	Username    *string `json:"username"`
	AvatarUrl   *string `json:"avatar_url"`
}

var messages = make(map[int][]string)
var mutex sync.RWMutex

func Json(chat string) string {
	return "```json\n" + chat + "\n```"
}

func Infof(f string, args ...any) {
	Webhooks(format(f, args...), InfoWebhook)
}

func Errorf(f string, args ...any) {
	Webhooks(format(f, args...), ErrorWebhook, InfoWebhook)
}

func format(f string, args ...any) string {
	s := f
	if len(args) > 0 {
		s = fmt.Sprintf(f, args...)
	}
	return s
}

func Webhooks(chat string, webhookTypes ...int) {
	hooks := mapset.NewSet(webhookTypes...)
	if hooks.Contains(ErrorWebhook) {
		log.Error(chat)
	} else {
		log.Info(chat)
	}
	if config.TheConfig.DiscordWebhookInfo == "" {
		return
	}
	mutex.Lock()
	defer mutex.Unlock()
	for _, webhookType := range webhookTypes {
		messages[webhookType] = append(messages[webhookType], chat)
	}
}

func messageTick() {
	mutex.Lock()
	currentMessages := make(map[int][]string)
	for k, v := range messages {
		currentMessages[k] = v
	}
	clear(messages)
	mutex.Unlock()
	for webhookType, messages := range currentMessages {
		if len(messages) > 0 {
			chunks := make([]string, 0)
			for _, message := range messages {
				if len(chunks) == 0 {
					chunks = append(chunks, message)
					continue
				}
				if len(chunks[len(chunks)-1])+len(message) > 1800 {
					chunks = append(chunks, message)
				} else {
					chunks[len(chunks)-1] = chunks[len(chunks)-1] + "\n" + message
				}
			}
			for _, chunk := range chunks {
				Send(MessagePayload{Content: &chunk,
					WebhookType: webhookType,
					Username:    &config.TheConfig.DiscordName})
			}
		}
	}
}

func Init() {
	scheduler := gocron.NewScheduler(time.Now().Location())
	_, err := scheduler.SingletonMode().Every(5).Seconds().Do(messageTick)
	if err != nil {
		log.Fatalf("error scheduling discord service: %v", err)
	}
	scheduler.StartAsync()
	cleanup.AddOnStopFunc(func(_ os.Signal) {
		scheduler.Stop()
		if len(messages) > 0 {
			messageTick()
		}
	})
}

type errorResponse struct {
	Message    string  `json:"message"`
	RetryAfter float64 `json:"retry_after"`
	Global     bool    `json:"global"`
}

const (
	InfoWebhook int = iota
	ErrorWebhook
	ChatWebhook
)

func Send(payload MessagePayload) {
	message := discordwebhook.Message{
		Username:  payload.Username,
		Content:   payload.Content,
		AvatarUrl: payload.AvatarUrl,
	}
	var err error
	switch payload.WebhookType {
	case ErrorWebhook:
		if config.TheConfig.DiscordWebhookError == "" {
			return
		}
		err = discordwebhook.SendMessage(config.TheConfig.DiscordWebhookError, message)
	case ChatWebhook:
		if config.TheConfig.DiscordWebhookChat == "" {
			return
		}
		err = discordwebhook.SendMessage(config.TheConfig.DiscordWebhookChat, message)
	default:
		err = discordwebhook.SendMessage(config.TheConfig.DiscordWebhookInfo, message)
	}

	if err != nil {
		de := &errorResponse{}
		jsonErr := json.Unmarshal([]byte(err.Error()), de)
		if jsonErr != nil {
			log.Errorf("error sending message to discord: %v", err)
			return
		}
		if de.RetryAfter > 0 {
			time.Sleep(time.Duration(de.RetryAfter) * time.Second)
			Send(payload)
		} else {
			log.Errorf("error sending message to discord: %v", err)
		}
	}
}
