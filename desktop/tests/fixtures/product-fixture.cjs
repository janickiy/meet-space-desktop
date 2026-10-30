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
async function createProductFixture(certificates, { notificationHeartbeatMs = 0 } = {}) {
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
  const controls = { offline: false, capabilityError: false, sentMessages: [], attachmentEvents: [], uploads: new Map(), activeConference: false };
  const membership = { id: "66666666-6666-4666-8666-666666666666", conferenceId: CONFERENCE, userId: USER_A,
    displayName: "Product owner", role: "owner", status: "joined", admissionState: "admitted", joinedAt: now, leftAt: null,
    createdAt: now, updatedAt: now, microphoneEnabled: false, cameraEnabled: false, screenSharing: false,
    microphoneBlocked: false, cameraBlocked: false, screenBlocked: false, mediaPolicyVersion: 1, admissionVersion: 1 };
  const fixture = await createFixture({ name: "product", certificates, ui: true, notificationHeartbeatMs, handleRequest: async ({ request, response, url, body, user, send }) => {
    const reply = (body, status = 200) => { send(response, status, { status: "success", ...body }); return true; };
    if (controls.offline) { request.socket.destroy(); return true; }
    const route = url.pathname.slice("/api/v1".length);
    if (route === "/auth/me/avatar") {
      if (controls.avatarFailure) return reply({status:"failed",message:"Photo upload unavailable"},503);
      if (request.method === "PUT") {
        controls.avatar = Buffer.from(body);
        controls.avatarUploads = (controls.avatarUploads || 0) + 1;
        user.avatarVersion = "fixture-avatar-" + controls.avatarUploads;
      } else { controls.avatar = null; user.avatarVersion = null; }
      return reply({ user });
    }
    if (/^\/users\/[^/]+\/avatar\/content$/.test(route)) {
      if (!controls.avatar) return reply({ status: "failed" }, 404);
      response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, no-store" });
      response.end(controls.avatar); return true;
    }
    if (route === `/conversations/${GROUP}/avatar`) {
      if (controls.groupAvatarFailure) return reply({status:"failed",message:"Group photo unavailable"},503);
      if (request.method === "PUT") {
        controls.groupAvatar = Buffer.from(body);
        controls.groupAvatarUploads = (controls.groupAvatarUploads || 0) + 1;
        group.avatarVersion = "fixture-group-avatar-" + controls.groupAvatarUploads;
      } else { controls.groupAvatar = null; group.avatarVersion = null; }
      return reply({ item: group });
    }
    if (route === `/conversations/${GROUP}/avatar/content`) {
      if (!controls.groupAvatar) return reply({status:"failed"},404);
      response.writeHead(200,{"content-type":"image/jpeg","cache-control":"private, no-store"});
      response.end(controls.groupAvatar);return true;
    }
    if (route === "/notifications/preferences") return reply({ invitation: true, reminder: true, recording: true, summary: true });
    if (route === "/capabilities" && controls.capabilityError) return reply({ status: "failed", message: "fixture capability unavailable" }, 503);
    if (route === "/me/conferences") return reply({ items: [url.searchParams.get("view") === "past" ? finished : conference], nextCursor: null });
    if (route === `/conferences/${CONFERENCE}`) return reply({ item: controls.activeConference ? { ...conference, status: "active", startedAt: now } : finished });
    if (route === `/conferences/${CONFERENCE}/participants/me`) return controls.activeConference ? reply({ item: membership }) : reply({ status: "failed", message: "not a participant" }, 404);
    if (route === `/conferences/${CONFERENCE}/participants`) return reply({ items: controls.activeConference ? [membership] : [] });
    if (route === `/conferences/${CONFERENCE}/messages` && request.method === "GET") return reply({ items: controls.sentMessages.filter(message => message.route === route).map(message => message.item), nextCursor: null, unreadCount: 0 });
    if (route === `/conferences/${CONFERENCE}/chat/read`) return reply({ item: { conferenceId: CONFERENCE, unreadCount: 0, lastReadSequence: "0", lastReadMessageId: null } });
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
    const attachmentInit = /^\/(conversations|conferences)\/([^/]+)\/attachments\/init$/.exec(route);
    if (attachmentInit && request.method === "POST") {
      const id = require("node:crypto").randomUUID();
      const item = { id, filename: body.filename, mimeType: body.mimeType, size: body.size, status: "pending" };
      const scope = `/${attachmentInit[1]}/${attachmentInit[2]}`;
      controls.uploads.set(id, { scope, item, init: body });
      controls.attachmentEvents.push({ phase: "init", id, scope, body });
      return reply({ item, uploadUrl: url.origin + `/api/v1${scope}/attachments/${id}/content` });
    }
    const attachmentOperation = /^\/(conversations|conferences)\/([^/]+)\/attachments\/([^/]+)\/(content|finalize)$/.exec(route);
    if (attachmentOperation) {
      const [, kind, scopeId, id, operation] = attachmentOperation;
      const upload = controls.uploads.get(id);
      if (!upload || upload.scope !== `/${kind}/${scopeId}`) return reply({ status: "failed" }, 404);
      if (operation === "content" && request.method === "PUT") {
        if (!Buffer.isBuffer(body) || body.length !== upload.item.size || request.headers["content-type"] !== upload.item.mimeType)
          return reply({ status: "failed", message: "attachment bytes/type mismatch" }, 400);
        upload.bytes = Buffer.from(body);
        upload.contentType = request.headers["content-type"];
        controls.attachmentEvents.push({ phase: "content", id, scope: upload.scope });
        return reply({ item: upload.item });
      }
      if (operation === "finalize" && request.method === "POST") {
        if (!upload.bytes) return reply({ status: "failed" }, 409);
        upload.item = { ...upload.item, status: "ready" };
        controls.attachmentEvents.push({ phase: "finalize", id, scope: upload.scope });
        return reply({ item: upload.item });
      }
    }
    if (/^\/(conversations|conferences)\/[^/]+\/messages$/.test(route) && request.method === "POST") {
      controls.sendAttempts ||= [];
      controls.sendAttempts.push({ route, body });
      if (controls.messageNetworkFailure) { request.socket.destroy(); return true; }
      const duplicate = controls.sentMessages.find(message => message.route === route && message.body.clientRequestId === body.clientRequestId);
      if (duplicate) return reply({ item: duplicate.item });
      const item = {
        id: require("node:crypto").randomUUID(), clientRequestId: body.clientRequestId,
        sequence: String(controls.sentMessages.length + 2), senderId: USER_A, senderName: "Product owner",
        text: body.text, attachments: (body.attachmentIds || []).map(id => controls.uploads.get(id)).filter(upload => upload?.scope + "/messages" === route && upload.item.status === "ready").map(upload => upload.item), replyTo: body.replyTo ?? null,
        ...(route.startsWith("/conversations/") ? { conversationId: route.split("/")[2] } : { conferenceId: CONFERENCE }),
        createdAt: new Date().toISOString(), updatedAt: now, editedAt: null, deletedAt: null, version: 1, important: false,
      };
      controls.sentMessages.push({ route, body, item });
      if (controls.loseMessageResponse) { controls.loseMessageResponse = false; request.socket.destroy(); return true; }
      return reply({ item });
    }
    for (const item of [direct, group]) {
      if (route === `/conversations/${item.id}`) return reply({ item });
      if (route === `/conversations/${item.id}/messages`) return reply({ items: [...(controls.messages?.map(message => ({ ...message, conversationId: item.id })) || [{ id: MESSAGE, sequence: "1", conversationId: item.id,
        senderId: USER_B, senderName: "Product direct peer", text: "Product server message", attachments: [attachment],
        createdAt: now, updatedAt: now, editedAt: null, deletedAt: null, version: 1, important: false, replyTo: null }]), ...controls.sentMessages.filter(message => message.route === route).map(message => message.item)], nextCursor: null, unreadCount: 0 });
      if (route === `/conversations/${item.id}/read` || route === `/conversations/${item.id}/chat/read`) return reply({ item: { conversationId: item.id, unreadCount: 0, lastReadSequence: "1", lastReadMessageId: MESSAGE } });
      if (route === `/conversations/${item.id}/peer-presence`) return reply({ item: { conversationId: item.id, peerId: USER_B, online: false } });
      if (route === `/conversations/${item.id}/members`) return reply({ items: [{ id: USER_A, displayName: "Product owner", role: "owner", online: false }, { id: USER_B, displayName: "Product direct peer", role: "member", online: false }] });
    }
    return false;
  } });
  return { ...fixture, product: { controls, conference, recording, attachment } };
}
module.exports = { createProductFixture, DIRECT, GROUP, FOLDER, RECORDING, FILE, ATTACHMENT };
