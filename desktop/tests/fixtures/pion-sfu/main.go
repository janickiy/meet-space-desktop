// This executable is a local test driver, not a server implementation. It imports
// the production SFU unchanged and replaces only authenticated signaling delivery
// with bounded stdin/stdout messages. It must never be packaged into the app.
package main

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/janickiy/meet-space/internal/config"
	"github.com/janickiy/meet-space/internal/domain/media"
	"github.com/janickiy/meet-space/internal/domain/realtime"
	"github.com/janickiy/meet-space/internal/infrastructure/sfu"
	"github.com/pion/logging"
	"github.com/pion/turn/v5"
	pion "github.com/pion/webrtc/v4"
)

type command struct {
	ID       string          `json:"id"`
	ClientID string          `json:"clientId"`
	Action   string          `json:"action"`
	Data     json.RawMessage `json:"data"`
}
type client struct {
	binding media.Binding
	peerID  string
}
type driver struct {
	mu                 sync.Mutex
	encoder            *json.Encoder
	manager            *sfu.Manager
	turnServer         *turn.Server
	turnConfig         config.TURNConfig
	conferenceID       string
	clients            map[string]*client
	clientByConnection sync.Map
	maxPeers           int
}

func (d *driver) write(value any) { d.mu.Lock(); defer d.mu.Unlock(); _ = d.encoder.Encode(value) }
func (d *driver) event(clientID, kind, replyTo string, data any) {
	event := realtime.Event(kind, d.conferenceID, data)
	event.ReplyTo = replyTo
	d.write(map[string]any{"clientId": clientID, "event": event})
}
func localIPv4() (net.IP, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := iface.Addrs()
		for _, address := range addresses {
			ip, _, err := net.ParseCIDR(address.String())
			if err == nil && ip.To4() != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
				return ip.To4(), nil
			}
		}
	}
	return nil, fmt.Errorf("local IPv4 interface unavailable")
}
func startTURN() (*turn.Server, config.TURNConfig, error) {
	ip, err := localIPv4()
	if err != nil {
		return nil, config.TURNConfig{}, err
	}
	listener, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		return nil, config.TURNConfig{}, err
	}
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		_ = listener.Close()
		return nil, config.TURNConfig{}, err
	}
	cfg := config.TURNConfig{URLs: []string{fmt.Sprintf("turn:127.0.0.1:%d?transport=udp", listener.LocalAddr().(*net.UDPAddr).Port)}, Secret: base64.RawURLEncoding.EncodeToString(secret), TTL: 5 * time.Minute, ForceRelay: true}
	logger := logging.NewDefaultLoggerFactory()
	logger.DefaultLogLevel = logging.LogLevelDisabled
	const realm = "meetspace-local-integration"
	server, err := turn.NewServer(turn.ServerConfig{
		Realm: realm, LoggerFactory: logger,
		AuthHandler: func(request *turn.RequestAttributes) (string, []byte, bool) {
			expires, err := strconv.ParseInt(strings.SplitN(request.Username, ":", 2)[0], 10, 64)
			if err != nil || expires < time.Now().Unix() || expires > time.Now().Add(6*time.Minute).Unix() {
				return "", nil, false
			}
			mac := hmac.New(sha1.New, []byte(cfg.Secret))
			_, _ = mac.Write([]byte(request.Username))
			password := base64.StdEncoding.EncodeToString(mac.Sum(nil))
			return request.Username, turn.GenerateAuthKey(request.Username, realm, password), true
		},
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: listener,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{RelayAddress: ip, Address: "0.0.0.0"},
			PermissionHandler:     func(_ net.Addr, peerIP net.IP) bool { return peerIP.IsLoopback() || peerIP.Equal(ip) },
		}},
	})
	if err != nil {
		_ = listener.Close()
		return nil, config.TURNConfig{}, err
	}
	return server, cfg, nil
}
func (d *driver) snapshot() any {
	s := d.manager.Snapshot()
	allocations := 0
	if d.turnServer != nil {
		allocations = d.turnServer.AllocationCount()
	}
	return map[string]any{"rooms": s.Rooms, "peers": s.Peers, "tracks": s.Tracks, "subscriptions": s.Subscriptions,
		"packets": s.Packets, "bytes": s.Bytes, "relayConnections": s.RelayConnections, "directConnections": s.DirectConnections,
		"failures": s.Failures, "turnAllocations": allocations}
}
func (d *driver) handle(request command) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if request.Action == "stats" {
		return d.snapshot(), nil
	}
	if request.Action == "room-close" {
		err := d.manager.CloseConference(ctx, d.conferenceID)
		return d.snapshot(), err
	}
	if request.ClientID == "" || len(request.ClientID) > 64 {
		return nil, media.ErrInvalid
	}
	current := d.clients[request.ClientID]
	if request.Action == "media.join" {
		if current == nil {
			current = &client{binding: media.Binding{ConferenceID: d.conferenceID, ParticipantID: uuid.NewString(), UserID: uuid.NewString(), SessionID: uuid.NewString(), ConnectionID: uuid.NewString(), AuthorizationExpiresAt: time.Now().Add(time.Hour)}}
			d.clients[request.ClientID] = current
			d.clientByConnection.Store(current.binding.ConnectionID, request.ClientID)
		}
		peer, err := d.manager.Join(ctx, current.binding)
		if err != nil {
			return nil, err
		}
		current.peerID = peer.MediaPeerID
		ice := d.turnConfig.ClientICE(realtime.ICEConfig{ICEServers: []realtime.ICEServer{}}, time.Now())
		tracks := d.manager.Tracks(peer.MediaPeerID)
		if tracks == nil {
			tracks = []media.Track{}
		}
		// These are the worker Result fields. Production controller propagation of
		// ICETransportPolicy is audited separately; this is media-engine verification.
		joined := map[string]any{"mediaPeerId": peer.MediaPeerID, "workerId": "local-real-pion", "maxPeers": d.maxPeers,
			"iceServers": ice.ICEServers, "iceTransportPolicy": ice.ICETransportPolicy, "iceExpiresAt": ice.ExpiresAt,
			"tracks": tracks, "videoCapture": media.VideoCaptureTarget{MaxWidth: 640, MaxHeight: 360, MaxFrameRate: 15}, "policy": media.ParticipantPolicy{}}
		d.event(request.ClientID, "media.joined", request.ID, joined)
		return peer, nil
	}
	if current == nil {
		return nil, media.ErrPeerNotFound
	}
	if request.Action == "policy" {
		var policy media.ParticipantPolicy
		if json.Unmarshal(request.Data, &policy) != nil {
			return nil, media.ErrInvalid
		}
		err := d.manager.SetPolicy(ctx, d.conferenceID, current.binding.ParticipantID, policy)
		return d.snapshot(), err
	}
	var signal media.Signal
	if json.Unmarshal(request.Data, &signal) != nil {
		return nil, media.ErrInvalid
	}
	if signal.MediaPeerID != current.peerID && !(request.Action == "media.leave" && signal.MediaPeerID == "") {
		return nil, media.ErrUnauthorized
	}
	switch request.Action {
	case "media.offer":
		answer, err := d.manager.OfferSources(ctx, current.peerID, signal.NegotiationID, signal.SDP, signal.Publications)
		if err != nil {
			return nil, err
		}
		d.event(request.ClientID, "media.answer", request.ID, map[string]any{"mediaPeerId": current.peerID, "negotiationId": signal.NegotiationID, "sdp": answer.SDP})
		return map[string]bool{"answered": true}, nil
	case "media.ready":
		if err := d.manager.Ready(ctx, current.peerID, signal.NegotiationID); err != nil {
			return nil, err
		}
		d.event(request.ClientID, "ack", request.ID, map[string]string{"type": "media.ready"})
		return map[string]bool{"ready": true}, nil
	case "media.ice":
		var candidate *pion.ICECandidateInit
		if json.Unmarshal(signal.Candidate, &candidate) != nil {
			return nil, media.ErrInvalid
		}
		return nil, d.manager.ICE(ctx, current.peerID, candidate)
	case "media.unpublish":
		return nil, d.manager.Unpublish(ctx, current.peerID, signal.TrackID)
	case "media.leave":
		if err := d.manager.Leave(ctx, current.peerID); err != nil {
			return nil, err
		}
		delete(d.clients, request.ClientID)
		d.clientByConnection.Delete(current.binding.ConnectionID)
		d.event(request.ClientID, "media.left", request.ID, map[string]string{"mediaPeerId": current.peerID})
		return d.snapshot(), nil
	default:
		return nil, media.ErrInvalid
	}
}
func main() {
	relay := flag.Bool("relay", false, "Use a real ephemeral local TURN server and force relay for Chromium peers")
	maxPeers := flag.Int("max-peers", 3, "Maximum peers in this disposable integration fixture (2 through 5)")
	flag.Parse()
	if *maxPeers < 2 || *maxPeers > 5 {
		fmt.Fprintln(os.Stderr, "local SFU fixture max-peers must be 2 through 5")
		os.Exit(1)
	}
	d := &driver{encoder: json.NewEncoder(os.Stdout), conferenceID: uuid.NewString(), clients: map[string]*client{}, maxPeers: *maxPeers}
	if *relay {
		server, cfg, err := startTURN()
		if err != nil {
			fmt.Fprintln(os.Stderr, "local TURN setup failed")
			os.Exit(1)
		}
		d.turnServer = server
		d.turnConfig = cfg
		defer server.Close()
	}
	manager, err := sfu.NewManager(sfu.Options{WorkerID: "local-real-pion", MaxPeers: *maxPeers, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Emit: func(binding media.Binding, kind string, data any) {
		if id, ok := d.clientByConnection.Load(binding.ConnectionID); ok {
			d.event(id.(string), kind, "", data)
		}
	}})
	if err != nil {
		fmt.Fprintln(os.Stderr, "local SFU setup failed")
		os.Exit(1)
	}
	d.manager = manager
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = manager.Shutdown(ctx)
	}()
	d.write(map[string]any{"ready": true, "relay": *relay, "maxPeers": *maxPeers, "conferenceId": d.conferenceID})
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 65536), 1024*1024)
	for scanner.Scan() {
		var request command
		if json.Unmarshal(scanner.Bytes(), &request) != nil || request.ID == "" {
			d.write(map[string]any{"ok": false, "error": "invalid_command"})
			continue
		}
		result, err := d.handle(request)
		if err != nil {
			code := media.ErrorCode(err)
			d.event(request.ClientID, "error", request.ID, map[string]string{"code": code})
			d.write(map[string]any{"id": request.ID, "ok": false, "error": code})
		} else {
			d.write(map[string]any{"id": request.ID, "ok": true, "result": result})
		}
	}
}
