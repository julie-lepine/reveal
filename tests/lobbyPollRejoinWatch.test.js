/**
 * Instrumentation rejoin-watch - pas de changement de stratégie contrôleur.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachPollChannelRejoinWatch,
  getPhoenixChannel,
} from "../js/core/lobbyPollRejoinWatch.js";

describe("lobbyPollRejoinWatch", () => {
  it("getPhoenixChannel: null si mock sans adapter", () => {
    assert.equal(getPhoenixChannel({ topic: "x" }), null);
    assert.equal(getPhoenixChannel(null), null);
  });

  it("attach sur mock sans Phoenix : no-op sûr + noteStatus", () => {
    const ch = { topic: "lobby-polls:x:1" };
    const watch = attachPollChannelRejoinWatch(
      ch,
      {
        channelGen: 1,
        topic: ch.topic,
        lobbyId: "L",
        votesPollId: null,
      },
      { force: true }
    );
    assert.equal(typeof watch.noteStatus, "function");
    watch.noteStatus("CHANNEL_ERROR", { message: "unmatched topic" });
    watch.noteStatus("CHANNEL_ERROR", { message: "unmatched topic" });
    const events = ch.__pollRejoinWatch.getEvents();
    assert.ok(events.some((e) => e.kind === "watch_attached"));
    assert.equal(
      events.filter((e) => e.kind === "subscribe_callback").length,
      2
    );
    watch.dispose();
  });

  it("sans force ni flag debug : no-op (pas d'hooks)", () => {
    const ch = { topic: "lobby-polls:x:1" };
    const watch = attachPollChannelRejoinWatch(ch, {
      channelGen: 1,
      topic: ch.topic,
      lobbyId: "L",
    });
    watch.noteStatus("CHANNEL_ERROR");
    assert.equal(ch.__pollRejoinWatch, undefined);
    watch.dispose();
  });

  it("wrap rejoin / resend / scheduleTimeout quand présents", () => {
    const calls = [];
    const joinPush = {
      ref: "1",
      resend(timeout) {
        calls.push(["resend", timeout]);
      },
    };
    const rejoinTimer = {
      tries: 0,
      scheduleTimeout() {
        this.tries += 1;
        calls.push(["schedule", this.tries]);
      },
      reset() {
        this.tries = 0;
        calls.push(["reset"]);
      },
    };
    const phoenix = {
      state: "errored",
      joinPush,
      rejoinTimer,
      rejoin(timeout) {
        calls.push(["rejoin", timeout]);
        joinPush.resend(timeout);
      },
    };
    const ch = {
      topic: "t",
      joinPush,
      rejoinTimer,
      state: "errored",
      channelAdapter: {
        getChannel() {
          return phoenix;
        },
        state: "errored",
      },
    };
    const watch = attachPollChannelRejoinWatch(
      ch,
      {
        channelGen: 2,
        topic: "t",
        lobbyId: "L",
      },
      { force: true }
    );
    rejoinTimer.scheduleTimeout();
    phoenix.rejoin(10000);
    const kinds = ch.__pollRejoinWatch.getEvents().map((e) => e.kind);
    assert.ok(kinds.includes("rejoinTimer_scheduleTimeout"));
    assert.ok(kinds.includes("phoenix_rejoin"));
    assert.ok(kinds.includes("joinPush_resend"));
    assert.deepEqual(calls, [
      ["schedule", 1],
      ["rejoin", 10000],
      ["resend", 10000],
    ]);
    watch.dispose();
  });
});
