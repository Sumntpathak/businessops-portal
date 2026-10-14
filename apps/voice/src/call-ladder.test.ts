import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isServiceOffer, ladderNote, ladderStepAfterTool } from "./call-ladder.js";

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

  it("recognises an offer only when the agent asks a booking or callback question", () => {
    assert.equal(isServiceOffer("I can offer general information. Would you like to book a consultation?"), true);
    assert.equal(isServiceOffer("The office is closed. Shall I arrange a callback for tomorrow?"), true);
    assert.equal(isServiceOffer("क्या मैं आपके लिए परामर्श बुक कर दूँ?"), true);
    assert.equal(isServiceOffer("Your consultation is booked. Is there anything else?"), false);
    assert.equal(isServiceOffer("A consultant would need to confirm that for your case."), false);
    assert.equal(isServiceOffer("We have over 15 years of experience. What else would you like to know?"), false);
  });

  it("offers a team member at the close only when someone can take the call", () => {
    assert.match(ladderNote(5, true) ?? "", /speak with someone from the team/);
    assert.doesNotMatch(ladderNote(5, false) ?? "", /someone from the team/);
    assert.match(ladderNote(4, true) ?? "", /team confirms payment/);
    assert.equal(ladderNote(1, true), null);
  });
});
