import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ladderNote, ladderStepAfterTool } from "./call-ladder.js";

describe("call ladder", () => {
  it("moves to step 2 when the name is saved and step 3 when the enquiry is saved", () => {
    assert.equal(ladderStepAfterTool(1, "update_caller_profile", { updated: ["name"] }), 2);
    assert.equal(ladderStepAfterTool(2, "update_caller_profile", { updated: ["enquiry"] }), 3);
    assert.equal(ladderStepAfterTool(1, "update_caller_profile", { updated: ["name", "enquiry"] }), 3);
  });

  it("moves to booking on slots and to closing on a booking or a callback", () => {
    assert.equal(ladderStepAfterTool(3, "check_availability", { slots: [] }), 4);
    assert.equal(ladderStepAfterTool(4, "create_booking", { bookingId: "b-1" }), 5);
    assert.equal(ladderStepAfterTool(2, "request_callback", { recorded: true }), 5);
  });

  it("never moves backwards, and ignores failed tools and unrelated saves", () => {
    assert.equal(ladderStepAfterTool(4, "update_caller_profile", { updated: ["name"] }), 4);
    assert.equal(ladderStepAfterTool(3, "create_booking", { error: "Requested booking slot is unavailable" }), 3);
    assert.equal(ladderStepAfterTool(3, "check_availability", { error: "timeout" }), 3);
    assert.equal(ladderStepAfterTool(1, "update_caller_profile", { updated: ["visa_type"] }), 1);
    assert.equal(ladderStepAfterTool(2, "transfer_to_staff", { transferring: true }), 2);
  });

  it("offers a team member at the close only when someone can take the call", () => {
    assert.match(ladderNote(5, true) ?? "", /speak with someone from the team/);
    assert.doesNotMatch(ladderNote(5, false) ?? "", /someone from the team/);
    assert.match(ladderNote(4, true) ?? "", /team confirms payment/);
    assert.equal(ladderNote(1, true), null);
  });
});
