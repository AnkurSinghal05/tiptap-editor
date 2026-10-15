import type { JSONContent } from "@tiptap/core";
import type { KbDocument } from "./types";

// Sample data for the mock backend, taken from the documents in the backend
// team's Postman collection (recorded GET / create responses). Vendor
// subSections from those recordings are left out: the API no longer accepts
// that type (handoff of Oct 15, 2026).

const heading = (level: 1 | 2 | 3, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const ul = (...items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((t) => ({ type: "listItem", content: [p(t)] })),
});
const clause = (id: string, tags: string[], ...content: JSONContent[]): JSONContent => ({
  type: "clause",
  attrs: { id, tags },
  content,
});
const wf = (id: string, title: string, ...clauses: JSONContent[]): JSONContent => ({
  type: "workflow",
  attrs: { id },
  content: [heading(3, title), ...clauses],
});
const sub = (type: string, id: string, name: string, ...children: JSONContent[]): JSONContent => ({
  type: "subSection",
  attrs: { type, id, name },
  content: [heading(2, name), ...children],
});
const doc = (id: string, title: string, ...children: JSONContent[]): KbDocument => ({
  type: "tnc",
  doc: { type: "doc", content: [{ type: "section", attrs: { id }, content: [heading(1, title), ...children] }] },
});

export const MOCK_SEED: KbDocument[] = [
  doc(
    "airport-transfer",
    "Airport Transfer",
    clause("cl-a1000001-0000-4000-8000-000000000001", ["eligibility"], p("Airport transfers are available to eligible members with an active card or membership at the time of booking and on the date of travel.")),
    clause("cl-a1000001-0000-4000-8000-000000000002", ["eligibility", "usage-limit"], p("Each eligible member may avail the number of complimentary transfers allotted to their program per calendar year. Unused transfers do not carry forward and cannot be exchanged for cash.")),
    clause(
      "cl-a1000001-0000-4000-8000-000000000003",
      ["coverage"],
      p("A transfer covers a one-way trip between the airport and a single address within the serviceable city limits."),
      ul(
        "Additional stops, detours and waiting beyond the free waiting period are chargeable.",
        "Tolls, parking and airport entry fees are included unless stated otherwise for the city.",
        "Inter-city transfers are not covered.",
      ),
    ),
    sub(
      "partner",
      "PTR-0108",
      "Premier Chauffeur Services",
      clause("cl-a1000001-0000-4000-8000-000000000004", ["partner-terms"], p("The chauffeur partner's code of conduct and safety policies apply in addition to these terms.")),
      wf("booking", "Booking", clause("cl-a1000001-0000-4000-8000-000000000005", ["lead-time"], p("Transfers must be booked at least 24 hours before the scheduled pickup time."))),
      wf("pending", "Pending", clause("cl-a1000001-0000-4000-8000-000000000006", ["sla"], p("If a request is still pending 6 hours before the pickup time, the member will be contacted with an alternative or the booking will be released without deducting a transfer."))),
      wf("cancellation", "Cancellation", clause("cl-a1000001-0000-4000-8000-000000000007", ["refund", "penalty"], p("Cancellations made within 12 hours of pickup are non-refundable and the transfer is deducted from the member's balance."))),
      wf("no-show", "No-show", clause("cl-a1000001-0000-4000-8000-000000000008", ["no-show", "penalty"], p("If the member does not arrive within the free waiting period and is unreachable, the trip is marked as a no-show and the transfer is deducted."))),
    ),
    sub(
      "facility",
      "FAC-DXB-T3",
      "Dubai International Airport - Terminal 3",
      clause("cl-a1000001-0000-4000-8000-000000000009", ["meeting-point"], p("The chauffeur meets the member at the arrivals hall exit with a name board. Members should contact the chauffeur after clearing customs.")),
      wf("booking", "Booking", clause("cl-a1000001-0000-4000-8000-000000000010", ["lead-time"], p("Bookings for this terminal must be made at least 36 hours in advance during peak travel periods."))),
    ),
  ),
  doc(
    "beach-club",
    "Beach Club Access",
    clause("cl-7f3d495b-b0e8-44f3-ac4e-661f4496919e", ["eligibility"], p("Beach club access is subject to daily capacity limits.")),
    clause("cl-8b35004b-85c3-4b0e-b296-2fa13e315170", ["guests"], p("Members may bring up to two guests per visit.")),
    sub(
      "partner",
      "PTR-0107",
      "Saadiyat Beach Club",
      clause("cl-5c69611b-769c-4476-a9b1-a0559217a122", ["entry_fee_beach_tag"], p("Day-pass fees are payable directly to the partner club.")),
      clause("cl-0f7870f6-fb03-4aa1-b248-a49a8f972787", ["dress_code"], p("Swimwear is permitted only in the pool and beach areas.")),
      wf(
        "pending",
        "Pending",
        clause("cl-2c9e882d-d0c4-4a20-9d81-47a484f2c5a3", [], p("Requests remain pending until the partner club confirms availability.")),
        clause("cl-56e845ad-71a9-4df3-a3ed-94a06dd48923", [], p("Pending requests expire after 24 hours.")),
      ),
      wf("cancellation", "Cancellation", clause("cl-f606da22-5f32-48a1-b299-c667e66ccc8a", ["refund"], p("Cancellations within 12 hours of the visit are non-refundable."))),
      wf("rescheduling", "Rescheduling", clause("cl-d5add59a-c4da-4ac0-84f1-bc217825f98f", ["reschedule"], p("A visit can be moved once, up to 6 hours before the booked slot."))),
    ),
    sub(
      "facility",
      "FAC-DXB-02",
      "Jumeirah Beach Resort",
      wf("booking", "Booking", clause("cl-68ba78f4-91e5-4175-a4c0-566a37bcd6cb", ["lead-time"], p("Cabanas must be booked at least 24 hours in advance."))),
    ),
  ),
  doc(
    "golf-booking",
    "Golf Booking",
    clause("cl-001a3825-943d-44e2-b571-e6f4ebc9f90c", ["eligibility"], p("Golf sessions are subject to course availability.")),
    clause("cl-7b94b91f-ea3b-4922-af8a-419f98f2086a", ["eligibility"], p("Members must carry a valid membership card.")),
    sub(
      "partner",
      "PTR-0042",
      "Abu Dhabi Golf Course",
      clause("cl-5a89fe42-39cd-479f-a3f0-33a4b6629f64", ["green_fee_golf_tag"], p("Green fees are payable directly to the partner course.")),
      clause("cl-d29ff3fe-41f1-4413-b305-0e59c9375c10", [], p("Caddie fees are not included.")),
      wf(
        "pending",
        "Pending",
        clause("cl-4e2f8485-60f3-4085-b2eb-511803c1deca", [], p("Requests remain pending until the partner course confirms the tee time.")),
        clause("cl-72883bb0-3894-47c8-823f-9a500a1256e2", [], p("Pending requests expire after 48 hours.")),
      ),
      wf("cancellation", "Cancellation", clause("cl-8e6b6fcc-ced9-41c7-b703-66590e99ef1c", ["refund"], p("Cancellations within 24 hours of the tee time are non-refundable."))),
      wf("rescheduling", "Rescheduling", clause("cl-91eaaef7-7f9c-43bb-84a7-c7a0a6c93114", ["reschedule"], p("Tee times can be moved once, up to 24 hours before."))),
    ),
    sub(
      "facility",
      "FAC-BLR-01",
      "Bengaluru Golf Club",
      wf("booking", "Booking", clause("cl-66cb2645-96fb-43c7-aff2-86aa0b22042d", ["lead-time"], p("Tee times must be booked at least 48 hours in advance."))),
    ),
  ),
];
