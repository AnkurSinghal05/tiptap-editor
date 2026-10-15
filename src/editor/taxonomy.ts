// Fixed lists used by the document structure, agreed with the backend team
// (docs/kb-api-integration.md, "Fixed lists"). Add new values here.
// Entities (section ids) are not a fixed list; they come from the backend.

export interface TaxonomyOption<T extends string = string> {
  value: T;
  label: string;
}

// Subsection types. A subsection is identified by (type, id) within a vertical.
export const SUBSECTION_TYPES = [
  { value: "facility", label: "Facility" },
  { value: "partner", label: "Partner" },
  { value: "service", label: "Service" },
  { value: "vendor", label: "Vendor" },
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
