package main

import (
	"Sparkle/cleanup"
	"Sparkle/config"
	"Sparkle/discord"
	log "github.com/sirupsen/logrus"
)

func main() {
	log.SetLevel(log.InfoLevel)
	config.Configure()
	discord.Init()
	blocking := make(chan bool, 1)
	cleanup.InitSignalCallback(blocking)
	REST()
}
