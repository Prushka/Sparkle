package plexauth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	bolt "go.etcd.io/bbolt"
)

const maxSessions = 2048

var sessionBucket = []byte("sessions-v1")
var errSessionStore = errors.New("Plex session storage is unavailable")

type sessionStore struct {
	db   *bolt.DB
	root *os.Root
}

// Authorization is deliberately absent: every restored session must verify the
// account and membership against the currently configured server before access.
type storedSession struct {
	Token     string    `json:"token"`
	Client    string    `json:"client"`
	Expires   time.Time `json:"expires"`
	Name      string    `json:"name"`
	ProfileID string    `json:"profileId"`
	Avatar    string    `json:"avatar"`
}

func resolvedDirectory(path string) (string, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	parent := filepath.Dir(path)
	if parent == path {
		return "", errSessionStore
	}
	real, err := resolvedDirectory(parent)
	return filepath.Join(real, filepath.Base(path)), err
}

func openSessionStore(dir string, publicDirs []string) (*sessionStore, error) {
	real, err := resolvedDirectory(dir)
	if err != nil || filepath.Dir(real) == real {
		return nil, errSessionStore
	}
	for _, public := range publicDirs {
		root, err := resolvedDirectory(public)
		if err != nil {
			return nil, errSessionStore
		}
		rel, err := filepath.Rel(root, real)
		if err == nil && (rel == "." || filepath.IsLocal(rel)) {
			return nil, errors.New("PLEX_AUTH_SESSION_DIR must be outside OUTPUT and PFP_DIR")
		}
	}
	if err := os.MkdirAll(real, 0o700); err != nil {
		return nil, errSessionStore
	}
	if err := privatePath(real, true); err != nil {
		return nil, errSessionStore
	}
	root, err := os.OpenRoot(real)
	if err != nil {
		return nil, errSessionStore
	}
	path := filepath.Join(real, "sessions.db")
	// Never follow a database symlink, including one elsewhere in this directory.
	if info, err := root.Lstat("sessions.db"); (err != nil && !errors.Is(err, os.ErrNotExist)) || (info != nil && !info.Mode().IsRegular()) {
		root.Close()
		return nil, errSessionStore
	}
	db, err := bolt.Open(path, 0o600, &bolt.Options{
		Timeout: time.Second, MaxSize: 128 << 20,
		OpenFile: func(_ string, flags int, mode os.FileMode) (*os.File, error) {
			file, err := root.OpenFile("sessions.db", flags, mode)
			if err != nil {
				return nil, errSessionStore
			}
			if err := privatePath(path, false); err != nil {
				file.Close()
				return nil, errSessionStore
			}
			return file, nil
		},
	})
	if err != nil {
		root.Close()
		return nil, errors.New("Cannot open Plex session storage; check permissions and ensure only one backend uses PLEX_AUTH_SESSION_DIR")
	}
	return &sessionStore{db: db, root: root}, nil
}

func (d *sessionStore) load() (map[[32]byte]*session, error) {
	records := make(map[[32]byte]storedSession)
	err := d.db.Update(func(tx *bolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists(sessionBucket)
		if err != nil {
			return err
		}
		cursor := bucket.Cursor()
		// Deleting in reverse order cannot skip the next record in a leaf.
		for key, value := cursor.Last(); key != nil; key, value = cursor.Prev() {
			var record storedSession
			if len(key) != 32 || len(value) > 24<<10 || json.Unmarshal(value, &record) != nil {
				return errSessionStore
			}
			client, err := base64.RawURLEncoding.DecodeString(record.Client)
			if err != nil || len(client) != 32 || len(record.Token) == 0 || len(record.Token) > 16384 || len(record.Name) > 512 || len(record.Avatar) > 4096 || !avatarFile.MatchString(record.ProfileID+".png") {
				return errSessionStore
			}
			if !time.Now().Before(record.Expires) {
				if err := cursor.Delete(); err != nil {
					return err
				}
				continue
			}
			if len(records) >= maxSessions {
				return errSessionStore
			}
			records[[32]byte(key)] = record
		}
		return nil
	})
	if err != nil {
		return nil, errors.New("Cannot read Plex session storage; restore a valid store or remove it to reset sign-ins")
	}
	sessions := make(map[[32]byte]*session, len(records))
	for key, record := range records {
		ctx, cancel := context.WithDeadline(context.Background(), record.Expires)
		sessions[key] = &session{token: record.Token, client: record.Client, expires: record.Expires,
			name: record.Name, profileID: record.ProfileID, avatar: safeAvatarURL(record.Avatar), ctx: ctx, cancel: cancel}
	}
	return sessions, nil
}

// replace commits creation and replacement together before a cookie is issued.
func (d *sessionStore) replace(key, old [32]byte, s *session) error {
	if d == nil {
		return nil
	}
	data, err := json.Marshal(storedSession{Token: s.token, Client: s.client, Expires: s.expires, Name: s.name, ProfileID: s.profileID, Avatar: s.avatar})
	if err != nil {
		return errSessionStore
	}
	if err := d.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(sessionBucket)
		if err := b.Delete(old[:]); err != nil {
			return err
		}
		return b.Put(key[:], data)
	}); err != nil {
		return errSessionStore
	}
	return nil
}

func (d *sessionStore) remove(keys ...[32]byte) error {
	if d == nil || len(keys) == 0 {
		return nil
	}
	if err := d.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(sessionBucket)
		for _, key := range keys {
			if err := b.Delete(key[:]); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return errSessionStore
	}
	return nil
}

func (d *sessionStore) close() {
	if d != nil {
		d.db.Close()
		d.root.Close()
	}
}
