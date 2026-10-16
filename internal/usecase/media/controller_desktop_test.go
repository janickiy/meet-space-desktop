package media

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/janickiy/meet-space/internal/config"
	domain "github.com/janickiy/meet-space/internal/domain/media"
	"github.com/janickiy/meet-space/internal/domain/realtime"
)

// Exercise the public controller entry point and the emitted WS envelope. The
// production regression lost fields between a correct worker response and WS.
func TestJoinedPreservesWorkerICEPolicy(t *testing.T) {
	for _, mode := range []string{"relay", "all", "legacy"} {
		t.Run(mode, func(t *testing.T) {
			ice := config.TURNConfig{URLs: []string{"turn:turn.fixture.invalid:3478?transport=udp"}, Secret: "test-only-shared-secret-32-bytes-long", TTL: 5 * time.Minute, ForceRelay: mode == "relay"}.ClientICE(realtime.ICEConfig{}, time.Now())
			if mode == "legacy" {
				ice.ICETransportPolicy = ""
				ice.ExpiresAt = 0
			}
			fixture := &joinedFixture{result: domain.Result{
				MediaPeerID: uuid.NewString(), WorkerID: "worker", MaxPeers: 3,
				ICEServers: ice.ICEServers, ICETransportPolicy: ice.ICETransportPolicy, ICEExpiresAt: ice.ExpiresAt,
				VideoCapture: domain.VideoCaptureTarget{MaxWidth: 640, MaxHeight: 360, MaxFrameRate: 15},
			}}
			controller := NewController(fixture, fixture, fixture, fixture, fixture, config.MediaConfig{OperationTimeout: time.Second, OwnershipTTL: time.Minute}, config.RealtimeConfig{SDPBytes: domain.MaxSDPBytes, ICEBytes: domain.MaxICEBytes})
			session := realtime.Session{ID: uuid.NewString(), ConferenceID: uuid.NewString(), ParticipantID: uuid.NewString(), ConnectionID: uuid.NewString(), UserID: uuid.NewString()}
			request := realtime.Event("media.join", session.ConferenceID, map[string]any{})
			if err := controller.Handle(context.Background(), session, time.Now().Add(time.Hour), request); err != nil {
				t.Fatalf("join failed: %v", err)
			}
			if fixture.bus.Event == nil || fixture.bus.Event.Type != "media.joined" || fixture.bus.Event.ReplyTo != request.ID || fixture.bus.ConnectionID != session.ConnectionID {
				t.Fatal("join response was not correlated with the authorized WS connection")
			}
			var payload struct {
				ICETransportPolicy *string              `json:"iceTransportPolicy"`
				ICEExpiresAt       *int64               `json:"iceExpiresAt"`
				ICEServers         []realtime.ICEServer `json:"iceServers"`
				Tracks             []domain.Track       `json:"tracks"`
			}
			if err := json.Unmarshal(fixture.bus.Event.Data, &payload); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(payload.ICEServers, ice.ICEServers) || payload.Tracks == nil {
				t.Fatal("join lost worker ICE servers or normalized track catalog")
			}
			if mode == "legacy" {
				if payload.ICETransportPolicy != nil || payload.ICEExpiresAt != nil {
					t.Fatal("legacy worker must retain optional-field compatibility")
				}
			} else if payload.ICETransportPolicy == nil || *payload.ICETransportPolicy != mode || payload.ICEExpiresAt == nil || *payload.ICEExpiresAt != ice.ExpiresAt {
				t.Fatal("media.joined lost worker ICE policy or credential expiry")
			}
		})
	}
}

type joinedFixture struct {
	result domain.Result
	bus    realtime.Bus
}

func (f *joinedFixture) Workers(context.Context) ([]domain.Worker, error) {
	return []domain.Worker{{ID: "worker"}}, nil
}
func (f *joinedFixture) Claim(context.Context, string, string, time.Duration) (domain.Route, error) {
	return domain.Route{WorkerID: "worker", LeaseID: "lease"}, nil
}
func (f *joinedFixture) GetOwner(context.Context, string) (domain.Route, error) {
	return domain.Route{WorkerID: "worker", LeaseID: "lease"}, nil
}
func (f *joinedFixture) Issue(domain.Binding, domain.Route) (string, error) {
	return "test-only-internal-ticket", nil
}
func (f *joinedFixture) Call(context.Context, string, domain.Command) (domain.Result, error) {
	return f.result, nil
}
func (f *joinedFixture) ValidateSession(context.Context, realtime.Session) error { return nil }
func (f *joinedFixture) Publish(_ context.Context, bus realtime.Bus) error {
	f.bus = bus
	return nil
}
