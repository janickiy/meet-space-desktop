// Disposable response shapes copied from the repository's public DTOs. No live data.
const { createFixture, CONFERENCE, USER_A, USER_B } = require("./https-fixture.cjs");
const DIRECT = "55555555-5555-4555-8555-555555555555";
const GROUP = "77777777-7777-4777-8777-777777777777";
const FOLDER = "88888888-8888-4888-8888-888888888888";
const RECORDING = "44444444-4444-4444-8444-444444444444";
const FILE = "99999999-9999-4999-8999-999999999999";
const MESSAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTACHMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date().toISOString();
async function createProductFixture(certificates) {
  const conference = {
    id: CONFERENCE, ownerId: USER_A, title: "Product scheduled meeting", inviteCode: "a".repeat(32), inviteUrl: "https://meeting.fixture.invalid/i/" + "a".repeat(32),
    status: "scheduled", createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
    scheduledAt: now, plannedDurationMin: 30, participantCount: 2, waitingRoomEnabled: false,
  };
  const finished = { ...conference, title: "Product finished meeting", status: "finished", startedAt: now, finishedAt: now };
  const direct = { id: DIRECT, type: "direct", peer: { id: USER_B, displayName: "Product direct peer" }, createdAt: now,
    lastMessageAt: now, lastMessageId: MESSAGE, preview: "Product direct private message", unreadCount: 0, notificationsEnabled: true, historyClearedThrough: 0 };
  const group = { id: GROUP, type: "group", name: "Product group chat", description: "Product private group", createdBy: USER_A,
    createdAt: now, updatedAt: now, lastMessageAt: now, lastMessageId: null, preview: "Product group private message", unreadCount: 0,
    memberCount: 2, myRole: "owner", avatarVersion: null, lastSender: null };
  const folder = { id: FOLDER, name: "Product personal folder", position: 0, createdAt: now, updatedAt: now,
    itemCount: 2, conversationCount: 1, conferenceCount: 1 };
  const recording = { uuid: RECORDING, conferenceId: CONFERENCE, mode: "composite", status: "ready", createdAt: now,
    startedAt: now, endedAt: now, durationSec: 12,
    files: [{ uuid: FILE, fileType: "final_mp4", sizeBytes: 1024,
      url: "https://must-not-load.fixture.invalid/private.mp4?signature=fixture" }] };
  const attachment = { id: ATTACHMENT, filename: "Product private attachment.txt", mimeType: "text/plain", size: 40, status: "ready" };
  const controls = { offline: false, capabilityError: false };
  const fixture = await createFixture({ name: "product", certificates, ui: true, handleRequest: async ({ request, response, url, send }) => {
    const reply = (body, status = 200) => { send(response, status, { status: "success", ...body }); return true; };
    if (controls.offline) { request.socket.destroy(); return true; }
    const route = url.pathname.slice("/api/v1".length);
    if (route === "/notifications/preferences") return reply({ invitation: true, reminder: true, recording: true, summary: true });
    if (route === "/capabilities" && controls.capabilityError) return reply({ status: "failed", message: "fixture capability unavailable" }, 503);
    if (route === "/me/conferences") return reply({ items: [url.searchParams.get("view") === "past" ? finished : conference], nextCursor: null });
    if (route === `/conferences/${CONFERENCE}`) return reply({ item: finished });
    if (route === `/conferences/${CONFERENCE}/participants/me`) return reply({ status: "failed", message: "not a participant" }, 404);
    if (route === `/conferences/${CONFERENCE}/recordings`) return reply({ items: [recording] });
    if (route === `/conferences/${CONFERENCE}/recordings/${RECORDING}`) return reply({ item: recording });
    if (route === `/conferences/${CONFERENCE}/history`) return reply({ item: { conference: finished,
      owner: { id: USER_A, displayName: "Product owner" }, durationSec: 12, participantCount: 2, participants: [],
      participantsTruncated: false, recordings: { total: 1, ready: 1, processing: 0, failed: 0 }, chatAvailable: false, chatReadOnly: true } });
    if (route === "/folders") return reply({ items: [folder] });
    if (route === `/folders/${FOLDER}`) return reply({ item: folder });
    if (route === `/folders/${FOLDER}/items`) return reply({ items: [{ type: "conversation", item: direct }, { type: "conference", item: conference }], nextCursor: null });
    if (route === "/conversations") {
      let items = [direct, group];
      if (url.searchParams.has("type")) items = items.filter(item => item.type === url.searchParams.get("type"));
      if (url.searchParams.has("search")) items = items.filter(item => (item.name || item.peer.displayName).toLowerCase().includes(url.searchParams.get("search").toLowerCase()));
      return reply({ items, nextCursor: null, unreadCount: 0 });
    }
    for (const item of [direct, group]) {
      if (route === `/conversations/${item.id}`) return reply({ item });
      if (route === `/conversations/${item.id}/messages`) return reply({ items: [{ id: MESSAGE, sequence: "1", conversationId: item.id,
        senderId: USER_B, senderName: "Product direct peer", text: "Product server message", attachments: [attachment],
        createdAt: now, updatedAt: now, editedAt: null, deletedAt: null, version: 1, important: false, replyTo: null }], nextCursor: null, unreadCount: 0 });
      if (route === `/conversations/${item.id}/read` || route === `/conversations/${item.id}/chat/read`) return reply({ item: { conversationId: item.id, unreadCount: 0, lastReadSequence: "1", lastReadMessageId: MESSAGE } });
      if (route === `/conversations/${item.id}/peer-presence`) return reply({ item: { conversationId: item.id, peerId: USER_B, online: false } });
      if (route === `/conversations/${item.id}/members`) return reply({ items: [{ id: USER_A, displayName: "Product owner", role: "owner", online: false }, { id: USER_B, displayName: "Product direct peer", role: "member", online: false }] });
    }
    return false;
  } });
  return { ...fixture, product: { controls, conference, recording, attachment } };
}
module.exports = { createProductFixture, DIRECT, GROUP, FOLDER, RECORDING, FILE, ATTACHMENT };
