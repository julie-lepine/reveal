import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOST_PRESENCE_STALE_MS, HOST_TRANSFER_STALE_MS } from "../js/config/lobbyLifecycle.js";
import {
  computeClaimEligible,
  decideActingHostNotice,
  hostAgeMs,
  isHostPresentAt,
  shouldNudgeClaimHubUi,
} from "../js/core/presenceUiLive.js";
import { resolveActingHostUserId } from "../js/core/hostPresence.js";

const HOST = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const GUEST = "11111111-1111-1111-1111-111111111111";
const OTHER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const T0 = 1_700_000_000_000;
const isoAgo = (ms) => new Date(T0 - ms).toISOString();

describe("presence live — acting 120s", () => {
  it("119s → 121s : acting host change + notice demandée une fois", () => {
    const members = [
      { userId: HOST, lastSeenAt: isoAgo(119_000) },
      { userId: GUEST, lastSeenAt: isoAgo(1000) },
    ];
    assert.equal(resolveActingHostUserId(members, HOST, T0), HOST);

    members[0].lastSeenAt = isoAgo(121_000);
    assert.equal(resolveActingHostUserId(members, HOST, T0), GUEST);

    const acked = new Set();
    const d1 = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: acked,
      inActivePlaySession: true,
    });
    assert.equal(d1.show, true);
    acked.add(1);

    const d2 = decideActingHostNotice({
      wasActing: true,
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: acked,
      inActivePlaySession: true,
    });
    assert.equal(d2.show, false);
  });

  it("poll 140s même token : pas de 2e notification", () => {
    const acked = new Set([1]);
    const d = decideActingHostNotice({
      wasActing: true,
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: acked,
      inActivePlaySession: true,
    });
    assert.equal(d.show, false);
    assert.equal(d.pending, false);
  });

  it("nudge sans session active : pending, token non ack", () => {
    const acked = new Set();
    const d = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 2,
      ackedTokens: acked,
      inActivePlaySession: false,
    });
    assert.equal(d.show, false);
    assert.equal(d.pending, true);
    assert.equal(acked.has(2), false);
  });

  it("vrai hôte : jamais de notice", () => {
    const d = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: true,
      token: 3,
      ackedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(d.show, false);
  });

  it("autre invité non élu : pas acting", () => {
    const members = [
      { userId: HOST, lastSeenAt: isoAgo(150_000) },
      { userId: GUEST, lastSeenAt: isoAgo(1000) },
      { userId: OTHER, lastSeenAt: isoAgo(1000) },
    ];
    assert.equal(resolveActingHostUserId(members, HOST, T0), GUEST);
    assert.notEqual(resolveActingHostUserId(members, HOST, T0), OTHER);
  });
});

describe("presence live — claim 300s hub", () => {
  it("299s → 301s : claimEligible false→true + nudge hub", () => {
    const members = [
      { userId: HOST, lastSeenAt: isoAgo(299_000) },
      { userId: GUEST, lastSeenAt: isoAgo(1000) },
    ];
    assert.equal(isHostPresentAt(members[0].lastSeenAt, T0, HOST_TRANSFER_STALE_MS), true);
    const before = computeClaimEligible({
      participants: members,
      hostId: HOST,
      localUserId: GUEST,
      now: T0,
    });
    assert.equal(before, false);

    members[0].lastSeenAt = isoAgo(301_000);
    assert.equal(isHostPresentAt(members[0].lastSeenAt, T0, HOST_TRANSFER_STALE_MS), false);
    const after = computeClaimEligible({
      participants: members,
      hostId: HOST,
      localUserId: GUEST,
      now: T0,
    });
    assert.equal(after, true);
    assert.equal(shouldNudgeClaimHubUi(before, after), true);
  });

  it("poll 320s état identique : pas de nudge répété", () => {
    assert.equal(shouldNudgeClaimHubUi(true, true), false);
    assert.equal(shouldNudgeClaimHubUi(false, false), false);
  });

  it("hôte revient : claimEligible true→false + CTA disparaît", () => {
    assert.equal(shouldNudgeClaimHubUi(true, false), true);
    const members = [
      { userId: HOST, lastSeenAt: isoAgo(1000) },
      { userId: GUEST, lastSeenAt: isoAgo(1000) },
    ];
    assert.equal(
      computeClaimEligible({
        participants: members,
        hostId: HOST,
        localUserId: GUEST,
        now: T0,
      }),
      false
    );
  });

  it("autre invité non candidat : aucun CTA", () => {
    const members = [
      { userId: HOST, lastSeenAt: isoAgo(400_000) },
      { userId: GUEST, lastSeenAt: isoAgo(1000) },
      { userId: OTHER, lastSeenAt: isoAgo(1000) },
    ];
    assert.equal(
      computeClaimEligible({
        participants: members,
        hostId: HOST,
        localUserId: OTHER,
        now: T0,
      }),
      false
    );
    assert.equal(
      computeClaimEligible({
        participants: members,
        hostId: HOST,
        localUserId: GUEST,
        now: T0,
      }),
      true
    );
  });

  it("bits hp/hc distincts aux seuils 120 / 300", () => {
    const at150 = isoAgo(150_000);
    assert.equal(isHostPresentAt(at150, T0, HOST_PRESENCE_STALE_MS), false);
    assert.equal(isHostPresentAt(at150, T0, HOST_TRANSFER_STALE_MS), true);
    assert.equal(hostAgeMs(at150, T0), 150_000);
  });

  it("seed null→false : pas de nudge hub", () => {
    assert.equal(shouldNudgeClaimHubUi(null, false), false);
    assert.equal(shouldNudgeClaimHubUi(null, true), false);
  });
});
