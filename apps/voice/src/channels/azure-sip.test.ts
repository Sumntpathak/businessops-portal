import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostFromSipHeader, phoneFromSipHeader, sipHeader } from "./azure-sip.js";

describe("Azure SIP header utilities", () => {
  it("extracts phone number from various SIP headers", () => {
    assert.equal(phoneFromSipHeader('<sip:+61413130084@eastus2.sip.ai.azure.com>'), "+61413130084");
    assert.equal(phoneFromSipHeader('"Caller" <sip:+916265846547@72.62.6.249>'), "+916265846547");
    assert.equal(phoneFromSipHeader("tel:+61370761437"), "+61370761437");
    assert.equal(phoneFromSipHeader(undefined), null);
    assert.equal(phoneFromSipHeader("invalid"), null);
  });

  it("extracts host and port from Contact and SIP headers", () => {
    assert.equal(hostFromSipHeader("<sip:asterisk@72.62.6.249:5062;transport=TLS>"), "72.62.6.249:5062");
    assert.equal(hostFromSipHeader("<sip:user@72.62.6.249>"), "72.62.6.249");
    assert.equal(hostFromSipHeader("<sip:test@sip.twilio.com:5061>"), "sip.twilio.com:5061");
    assert.equal(hostFromSipHeader("sip:pbx.example.com"), "pbx.example.com");
    assert.equal(hostFromSipHeader(undefined), null);
  });

  it("finds case-insensitive header values from incoming call event", () => {
    const event = {
      id: "evt-1",
      data: {
        call_id: "c-1",
        sip_headers: [
          { name: "Contact", value: "<sip:asterisk@72.62.6.249:5062;transport=TLS>" },
          { name: "From", value: "<sip:+916265846547@72.62.6.249>" }
        ]
      }
    };
    assert.equal(sipHeader(event, "contact"), "<sip:asterisk@72.62.6.249:5062;transport=TLS>");
    assert.equal(sipHeader(event, "FROM"), "<sip:+916265846547@72.62.6.249>");
    assert.equal(sipHeader(event, "Missing"), undefined);
  });
});
