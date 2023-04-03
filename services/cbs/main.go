package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/privacypass/challenge-bypass-server/server"
)

// TODO maybe expose an HTTP /healthz endpoint?

const (
	keyFile        = "/tmp/cbs_key.pem"
	commitmentFile = "/tmp/cbs_commitment.json"
	redeemKeysFile = "/tmp/cbs_redeem_keys.pem"

	dayDuration = 24 * time.Hour
	keyFormat   = "2006-01"
)

type secretsObject struct {
	Keys        map[string]string
	Commitments map[string]string
}

func main() {
	log.SetPrefix("[coil-cbs] ")
	var secrets secretsObject
	var err error
	must(json.Unmarshal([]byte(os.Getenv("SECRETS")), &secrets))

	listenPort, err := strconv.Atoi(os.Getenv("PORT"))
	must(err)
	metricsPort, err := strconv.Atoi(os.Getenv("METRICS_PORT"))
	must(err)
	maxTokens, err := strconv.Atoi(os.Getenv("MAX_TOKENS"))
	must(err)

	srv := &server.Server{
		BindAddress: "127.0.0.1",
		ListenPort:  listenPort,
		MetricsPort: metricsPort,
		MaxTokens:   maxTokens,
		KeyVersion:  "1.0",
	}

	commitmentKey := currentCommitmentKey()
	must(reloadServerKeys(srv, &secrets, commitmentKey))

	go func() {
		for {
			time.Sleep(time.Minute)
			nextKey := currentCommitmentKey()
			if commitmentKey != nextKey {
				log.Println("commitment key changed; cycling keys")
				// Make sure to use the new key.
				must(reloadServerKeys(srv, &secrets, nextKey))
				commitmentKey = nextKey
				log.Println("keys cycled")
			}
		}
	}()

	must(srv.ListenAndServe())
}

func reloadServerKeys(
	srv *server.Server,
	secrets *secretsObject,
	ck string,
) error {
	if err := writeKeys(secrets, ck); err != nil {
		return err
	}
	return srv.LoadKeys(keyFile, commitmentFile, redeemKeysFile)
}

func writeKeys(secrets *secretsObject, ck string) error {
	key, ok := secrets.Keys[ck]
	if !ok {
		return fmt.Errorf("No key found; key=%s", ck)
	}
	commitment, ok := secrets.Commitments[ck]
	log.Println("Reload:", ck, "commitment:", commitment)
	if !ok {
		return fmt.Errorf("No commitment found; key=%s", ck)
	}

	if err := writeFile(keyFile, key); err != nil {
		return err
	}
	if err := writeFile(commitmentFile, commitment); err != nil {
		return err
	}
	if err := writeFile(redeemKeysFile, string(secrets.redeemKeys())); err != nil {
		return err
	}
	return nil
}

func writeFile(path string, data string) error {
	return ioutil.WriteFile(path, []byte(data), 0600)
}

func currentCommitmentKey() string {
	return time.Now().UTC().Format(keyFormat)
}

func (s *secretsObject) redeemKeys() []byte {
	currentKey := currentCommitmentKey()

	now := time.Now().UTC()
	var year int
	var month time.Month
	if now.Month() == time.January {
		year, month = now.Year()-1, time.December
	} else {
		year, month = now.Year(), now.Month()-1
	}
	prevKey := fmt.Sprintf("%d-%02d", year, month)

	var data []byte
	data = append(data, []byte(s.Keys[currentKey])...)
	data = append(data, '\n')
	data = append(data, []byte(s.Keys[prevKey])...)

	// Trim off leading/trailing newlines to keep the bypass-server's PEM
	// parser from panicking.
	return bytes.Trim(data, "\n")
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
