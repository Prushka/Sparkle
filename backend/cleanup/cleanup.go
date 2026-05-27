package cleanup

import (
	"os"
	"os/signal"
	"sync"
	"syscall"

	log "github.com/sirupsen/logrus"
)

type OnStop func(sig os.Signal)

type stop struct {
	isStopping bool
	mutex      sync.Mutex
	onStopFunc []OnStop
}

var quitInstance = &stop{
	isStopping: false,
}

func AddOnStopFunc(f OnStop) {
	quitInstance.mutex.Lock()
	defer quitInstance.mutex.Unlock()
	quitInstance.onStopFunc = append(quitInstance.onStopFunc, f)
	if quitInstance.isStopping {
		f(syscall.SIGTERM)
	}
}

func Stop(sig os.Signal) {
	quitInstance.mutex.Lock()
	defer quitInstance.mutex.Unlock()
	quitInstance.isStopping = true
	log.Warnf("Received signal %d, terminating...", sig)
	for _, f := range quitInstance.onStopFunc {
		f(sig)
	}
}

func InitSignalCallback(blocking chan bool) {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan,
		syscall.SIGHUP,
		syscall.SIGINT,
		syscall.SIGTERM,
		syscall.SIGQUIT)
	go func() {
		sig := <-sigChan
		Stop(sig)
		blocking <- true
	}()
}
