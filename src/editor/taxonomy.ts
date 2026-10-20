// Fixed lists used by the document structure, agreed with the backend team
// (docs/kb-api-integration.md, "Fixed lists"). Add new values here.

export interface TaxonomyOption<T extends string = string> {
  value: T;
  label: string;
}

// Entities (section ids). The backend can't list them (GET /knowledge-base
// needs an entity_id), so the frontend keeps the list. Same for every
// document type; an entity may not have a document of a given type yet.
export const ENTITIES = [
  { value: "golf-booking", label: "Golf Booking" },
  { value: "airport-transfer-booking", label: "Airport Transfer Booking" },
  { value: "golf-booking-learn", label: "Golf Booking Learn" },
  { value: "unique-coupon", label: "Unique Coupon" },
  { value: "gym-club-booking", label: "Gym Club Booking" },
  { value: "dynamic-coupon", label: "Dynamic Coupon" },
  { value: "beach-club", label: "Beach Club" },
  { value: "valet-booking", label: "Valet Booking" },
  { value: "padel-booking", label: "Padel Booking" },
  { value: "ladies-club", label: "Ladies Club" },
  { value: "car-servicing", label: "Car Servicing" },
  { value: "static-coupon", label: "Static Coupon" },
  { value: "delayed", label: "Delayed" },
  { value: "meet-and-greet-booking", label: "Meet And Greet Booking" },
  { value: "car-registration", label: "Car Registration" },
  { value: "custom-delayed", label: "Custom Delayed" },
  { value: "courier-booking", label: "Courier Booking" },
] as const;

export type EntityId = (typeof ENTITIES)[number]["value"];

// Subsection types: discovery catalog items. A subsection is identified by
// (type, id) within an entity. The API accepts only these three (`vendor` was
// dropped in the handoff of Oct 15, 2026).
export const SUBSECTION_TYPES = [
  { value: "facility", label: "Facility" },
  { value: "partner", label: "Partner" },
  { value: "service", label: "Service" },
] as const;

export type SubSectionType = (typeof SUBSECTION_TYPES)[number]["value"];

// Workflows → Workflow ids (at most once per subsection).
export const WORKFLOWS = [
  { value: "booking", label: "Booking" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "failed", label: "Failed" },
  { value: "modification", label: "Modification" },
  { value: "rescheduling", label: "Rescheduling" },
  { value: "cancellation", label: "Cancellation" },
  { value: "no-show", label: "No-show" },
  { value: "rentals", label: "Rentals" },
] as const;

export type WorkflowId = (typeof WORKFLOWS)[number]["value"];

export const isOneOf = <T extends string>(
  options: readonly TaxonomyOption<T>[],
  value: unknown,
): value is T => options.some((o) => o.value === value);

export const labelOf = <T extends string>(options: readonly TaxonomyOption<T>[], value: T) =>
  options.find((o) => o.value === value)?.label ?? value;
