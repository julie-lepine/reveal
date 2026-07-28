import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_MEMBERSHIP_QUERY_LIMIT,
  compareMembershipRowsDeterministic,
  membershipFromLivingRow,
  interpretLivingMembershipRows,
  membershipQueryNone,
  membershipQueryUnknown,
  queryActiveLobbyMembership,
} from "../js/core/lobbyMembershipQuery.js";
import {
  normalizePostgrestMembershipRow,
  normalizePostgrestMembershipData,
} from "../js/core/lobbyMembershipNormalize.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
  getMembershipSnapshotForUser,
} from "../js/core/lobbyMembershipSnapshot.js";
import {
  resetMembershipSnapshotTestState,
  clearMembershipSnapshotTestState,
} from "./helpers/membershipSnapshotTest.js";

const UID = "user-aaa-1111-2222-3333";
const HOST_UID = UID;
const OTHER_UID = "user-bbb-4444-5555-6666";

function livingRow(overrides = {}) {
  return {
    lobbyId: "lobby-1",
    joinedAt: "2026-07-01T12:00:00.000Z",
    code: "ABCD",
    lobbyStatus: "waiting",
    gameId: "guesslie",
    hostId: HOST_UID,
    ...overrides,
  };
}

describe("lobbyMembershipVagueA — constantes & helpers", () => {
  it("ACTIVE_MEMBERSHIP_QUERY_LIMIT = 20", () => {
    assert.equal(ACTIVE_MEMBERSHIP_QUERY_LIMIT, 20);
  });

  it("membershipQueryNone / Unknown", () => {
    assert.deepEqual(membershipQueryNone(), { status: "none" });
    assert.deepEqual(membershipQueryUnknown(), { status: "unknown" });
  });

  it("membershipFromLivingRow — hôte vs non-hôte ; défaut member si hostId manquant", () => {
    assert.equal(membershipFromLivingRow(livingRow({ hostId: HOST_UID }), UID).role, "host");
    assert.equal(
      membershipFromLivingRow(livingRow({ hostId: OTHER_UID }), UID).role,
      "member"
    );
    assert.equal(
      membershipFromLivingRow(livingRow({ hostId: null }), UID).role,
      "member"
    );
    assert.equal(membershipFromLivingRow({ lobbyId: "x" }, UID), null);
  });

  it("compareMembershipRowsDeterministic — joined_at DESC puis lobbyId ASC", () => {
    const older = livingRow({
      lobbyId: "lobby-z",
      joinedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = livingRow({
      lobbyId: "lobby-a",
      joinedAt: "2026-07-01T00:00:00.000Z",
    });
    assert.ok(compareMembershipRowsDeterministic(newer, older) < 0);
    assert.ok(compareMembershipRowsDeterministic(older, newer) > 0);

    const sameTimeA = livingRow({
      lobbyId: "lobby-a",
      joinedAt: "2026-07-01T00:00:00.000Z",
    });
    const sameTimeB = livingRow({
      lobbyId: "lobby-b",
      joinedAt: "2026-07-01T00:00:00.000Z",
    });
    assert.ok(compareMembershipRowsDeterministic(sameTimeA, sameTimeB) < 0);
  });
});

describe("lobbyMembershipVagueA — interpretLivingMembershipRows", () => {
  it("aucune membership → none", () => {
    assert.deepEqual(interpretLivingMembershipRows(UID, []), membershipQueryNone());
    assert.deepEqual(interpretLivingMembershipRows(UID, null), membershipQueryNone());
  });

  it("une membership vivante → found + métadonnées ; non-hôte → role member", () => {
    const row = livingRow({ hostId: OTHER_UID, gameId: "hotTake", lobbyStatus: "playing" });
    const result = interpretLivingMembershipRows(UID, [row]);
    assert.equal(result.status, "found");
    assert.deepEqual(result.membership, {
      lobbyId: "lobby-1",
      code: "ABCD",
      lobbyStatus: "playing",
      gameId: "hotTake",
      role: "member",
    });
    assert.equal(result.extraCount, 0);
  });

  it("rows invalides / sans lobby vivant → pas found", () => {
    const result = interpretLivingMembershipRows(UID, [
      { lobbyId: "", code: "X" },
      { lobbyId: "id", code: "" },
      { joinedAt: "2020-01-01T00:00:00.000Z" },
    ]);
    assert.equal(result.status, "none");
    assert.equal(result.membership, undefined);
  });

  it("membership > 24 h → toujours found (pas de filtre âge)", () => {
    const old = livingRow({
      joinedAt: "2020-01-01T00:00:00.000Z",
    });
    const result = interpretLivingMembershipRows(UID, [old]);
    assert.equal(result.status, "found");
    assert.equal(result.membership.lobbyId, "lobby-1");
  });

  it("multi-memberships → sélection déterministe + extraCount + log ; pas de mutation input", () => {
    const logs = [];
    const rows = [
      livingRow({
        lobbyId: "lobby-b",
        joinedAt: "2026-07-01T00:00:00.000Z",
        code: "BBBB",
      }),
      livingRow({
        lobbyId: "lobby-a",
        joinedAt: "2026-07-01T00:00:00.000Z",
        code: "AAAA",
      }),
      livingRow({
        lobbyId: "lobby-old",
        joinedAt: "2025-01-01T00:00:00.000Z",
        code: "OLD1",
      }),
    ];
    const frozen = structuredClone(rows);
    const result = interpretLivingMembershipRows(UID, rows, {
      logMulti: (p) => logs.push(p),
    });

    assert.equal(result.status, "found");
    // Même joined_at → tie-break lobbyId ASC → lobby-a
    assert.equal(result.membership.lobbyId, "lobby-a");
    assert.equal(result.membership.code, "AAAA");
    assert.equal(result.extraCount, 2);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].count, 3);
    assert.ok(Array.isArray(logs[0].lobbyIdsSample));
    assert.ok(String(logs[0].uidTruncated || "").includes(UID.slice(0, 8)));
    assert.deepEqual(rows, frozen);
  });

  it("tie-break lobbyId ASC quand joined_at égal", () => {
    const result = interpretLivingMembershipRows(UID, [
      livingRow({ lobbyId: "lobby-z", joinedAt: "2026-06-01T00:00:00.000Z", code: "ZZZZ" }),
      livingRow({ lobbyId: "lobby-m", joinedAt: "2026-06-01T00:00:00.000Z", code: "MMMM" }),
    ]);
    assert.equal(result.membership.lobbyId, "lobby-m");
  });
});

describe("lobbyMembershipVagueA — queryActiveLobbyMembership (injectable)", () => {
  it("aucune membership → none", async () => {
    const result = await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: () => true,
      fetchLivingMembershipRows: async () => ({ ok: true, rows: [] }),
    });
    assert.equal(result.status, "none");
  });

  it("une membership vivante → found", async () => {
    const result = await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: () => true,
      fetchLivingMembershipRows: async () => ({
        ok: true,
        rows: [livingRow({ hostId: UID })],
      }),
    });
    assert.equal(result.status, "found");
    assert.equal(result.membership.role, "host");
    assert.equal(result.membership.code, "ABCD");
  });

  it("erreur / ok:false → unknown (jamais none)", async () => {
    const r1 = await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: () => true,
      fetchLivingMembershipRows: async () => ({ ok: false, error: new Error("net") }),
    });
    assert.equal(r1.status, "unknown");

    const r2 = await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: () => true,
      fetchLivingMembershipRows: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(r2.status, "unknown");
  });

  it("uid absent → unknown, aucun fetch", async () => {
    let fetchCalls = 0;
    const result = await queryActiveLobbyMembership({
      userId: null,
      getUserId: () => null,
      isSupabaseConfigured: () => true,
      fetchLivingMembershipRows: async () => {
        fetchCalls += 1;
        return { ok: true, rows: [] };
      },
    });
    assert.equal(result.status, "unknown");
    assert.equal(fetchCalls, 0);
  });

  it("!configured → unknown", async () => {
    let fetchCalls = 0;
    const result = await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: () => false,
      fetchLivingMembershipRows: async () => {
        fetchCalls += 1;
        return { ok: true, rows: [] };
      },
    });
    assert.equal(result.status, "unknown");
    assert.equal(fetchCalls, 0);
  });

  it("deps invalides → unknown", async () => {
    assert.equal((await queryActiveLobbyMembership(null)).status, "unknown");
    assert.equal((await queryActiveLobbyMembership({})).status, "unknown");
  });

  it("ok:true avec rows undefined → interpret [] → none", async () => {
    const result = await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: true,
      fetchLivingMembershipRows: async () => ({ ok: true }),
    });
    assert.equal(result.status, "none");
  });

  it("query / interpret n’écrivent ni inLobby/lobby/lobbyCode ni snapshot", async () => {
    const { getState } = await import("../js/core/state.js");
    const before = getState();
    invalidateMembershipSnapshot();
    await queryActiveLobbyMembership({
      userId: UID,
      isSupabaseConfigured: () => true,
      fetchLivingMembershipRows: async () => ({
        ok: true,
        rows: [livingRow()],
      }),
    });
    interpretLivingMembershipRows(UID, [livingRow()]);
    assert.equal(getMembershipSnapshot(), null);
    const after = getState();
    assert.equal(after.inLobby, before.inLobby);
    assert.equal(after.lobby, before.lobby);
    assert.equal(after.lobbyCode, before.lobbyCode);
  });
});

describe("lobbyMembershipVagueA — snapshot", () => {
  beforeEach(() => {
    resetMembershipSnapshotTestState(UID);
  });

  it("R/W found", () => {
    const written = setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: "L1",
          code: "CODE",
          lobbyStatus: "waiting",
          gameId: "x",
          role: "host",
        },
        extraCount: 0,
      },
      "test",
      UID
    );
    assert.equal(written.status, "found");
    assert.equal(written.userId, UID);
    assert.equal(written.source, "test");
    assert.ok(typeof written.checkedAt === "number");
    const got = getMembershipSnapshot();
    assert.equal(got.status, "found");
    assert.equal(got.membership.code, "CODE");
    assert.equal(got.extraCount, 0);
  });

  it("unknown dans le snapshot", () => {
    setMembershipSnapshot({ status: "unknown" }, "net-error", UID);
    const got = getMembershipSnapshot();
    assert.equal(got.status, "unknown");
    assert.equal(got.membership, undefined);
    assert.equal(got.extraCount, undefined);
    assert.equal(got.source, "net-error");
  });

  it("found → none retire membership + extraCount", () => {
    setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: "L1",
          code: "CODE",
          lobbyStatus: "waiting",
          gameId: null,
          role: "member",
        },
        extraCount: 2,
      },
      "src",
      UID
    );
    setMembershipSnapshot({ status: "none" }, "fresh-none", UID);
    const got = getMembershipSnapshot();
    assert.equal(got.status, "none");
    assert.equal(got.membership, undefined);
    assert.equal(got.extraCount, undefined);
    assert.equal(got.source, "fresh-none");
  });

  it("found → unknown retire membership + extraCount", () => {
    setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: "L1",
          code: "CODE",
          lobbyStatus: "waiting",
          gameId: null,
          role: "member",
        },
        extraCount: 1,
      },
      "src",
      UID
    );
    setMembershipSnapshot({ status: "unknown" }, "src2", UID);
    const got = getMembershipSnapshot();
    assert.equal(got.status, "unknown");
    assert.equal(got.membership, undefined);
    assert.equal(got.extraCount, undefined);
  });

  it("invalidate → null", () => {
    setMembershipSnapshot({ status: "none" }, "src", UID);
    invalidateMembershipSnapshot();
    assert.equal(getMembershipSnapshot(), null);
  });

  it("muter get / membership.code / source post-set / return de set ne corrompt pas le stockage", () => {
    const returned = setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: "L1",
          code: "ORIG",
          lobbyStatus: "waiting",
          gameId: "g",
          role: "host",
        },
        extraCount: 0,
      },
      "src-a",
      UID
    );

    returned.status = "none";
    returned.source = "hacked";
    returned.membership.code = "HACK";
    returned.extraCount = 99;

    const got = getMembershipSnapshot();
    got.status = "unknown";
    got.membership.code = "MUTATED";
    got.source = "mut";

    const again = getMembershipSnapshot();
    assert.equal(again.status, "found");
    assert.equal(again.membership.code, "ORIG");
    assert.equal(again.source, "src-a");
    assert.equal(again.extraCount, 0);
  });

  it("E1 — snapshot autre userId non exposé", () => {
    setMembershipSnapshot({ status: "found", membership: { lobbyId: "L1", code: "X", lobbyStatus: null, gameId: null, role: "member" } }, "t", UID);
    assert.equal(getMembershipSnapshotForUser("other-user"), null);
  });
});

describe("lobbyMembershipVagueA — normalize PostgREST", () => {
  it("objet lobbies → LivingRow", () => {
    const row = normalizePostgrestMembershipRow({
      lobby_id: "lobby-1",
      joined_at: "2026-07-01T12:00:00.000Z",
      lobbies: {
        id: "lobby-1",
        code: "ABCD",
        status: "waiting",
        game_id: "guesslie",
        host_id: HOST_UID,
      },
    });
    assert.deepEqual(row, {
      lobbyId: "lobby-1",
      joinedAt: "2026-07-01T12:00:00.000Z",
      code: "ABCD",
      lobbyStatus: "waiting",
      gameId: "guesslie",
      hostId: HOST_UID,
    });
  });

  it("lobbies: null / sans id / sans code → null", () => {
    assert.equal(
      normalizePostgrestMembershipRow({
        lobby_id: "x",
        joined_at: null,
        lobbies: null,
      }),
      null
    );
    assert.equal(
      normalizePostgrestMembershipRow({
        lobby_id: "x",
        lobbies: { id: "", code: "AB" },
      }),
      null
    );
    assert.equal(
      normalizePostgrestMembershipRow({
        lobby_id: "x",
        lobbies: { id: "id", code: "" },
      }),
      null
    );
  });

  it("data absente → []", () => {
    assert.deepEqual(normalizePostgrestMembershipData(null), []);
    assert.deepEqual(normalizePostgrestMembershipData(undefined), []);
  });

  it("lobbies tableau → null", () => {
    assert.equal(
      normalizePostgrestMembershipRow({
        lobby_id: "x",
        lobbies: [{ id: "a", code: "AB" }],
      }),
      null
    );
  });

  it("normalizePostgrestMembershipData map + filter", () => {
    const rows = normalizePostgrestMembershipData([
      {
        lobby_id: "a",
        joined_at: "2026-01-01T00:00:00.000Z",
        lobbies: { id: "a", code: "AAAA", status: "waiting", game_id: null, host_id: null },
      },
      { lobby_id: "b", lobbies: null },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code, "AAAA");
  });
});
