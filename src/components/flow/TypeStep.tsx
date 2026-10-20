import type { IconType } from "react-icons";
import {
  MdArrowForward,
  MdCheckCircle,
  MdHelpOutline,
  MdOutlineConfirmationNumber,
  MdOutlineDescription,
  MdOutlineSchedule,
} from "react-icons/md";
import { DOC_TYPES, type DocType } from "../../api/kb/types";
import { labelOf } from "../../editor/taxonomy";

// How each document type is presented in the create flow, in this order.
export const DOC_TYPE_INFO: { value: DocType; short: string; description: string; icon: IconType }[] = [
  {
    value: "tnc",
    short: "T&C",
    description: "Rules members agree to: booking, cancellation, conduct and charges.",
    icon: MdOutlineDescription,
  },
  {
    value: "redemption_process",
    short: "Redemption",
    description: "How a member uses the benefit, from booking to arriving on site.",
    icon: MdOutlineConfirmationNumber,
  },
  {
    value: "faq",
    short: "FAQ",
    description: "Common member questions and their answers.",
    icon: MdHelpOutline,
  },
  {
    value: "sla",
    short: "SLA",
    description: "Turnaround commitments for each booking stage.",
    icon: MdOutlineSchedule,
  },
];

export const shortTypeLabel = (docType: DocType) => DOC_TYPE_INFO.find((t) => t.value === docType)?.short ?? docType;

interface TypeStepProps {
  value: DocType | null;
  onChange: (docType: DocType) => void;
  onNext: () => void;
}

// Step 1: which kind of document to work on.
export const TypeStep = ({ value, onChange, onNext }: TypeStepProps) => (
  <section className="flow-card" aria-labelledby="type-step-title">
    <h2 id="type-step-title">What do you want to work on?</h2>
    <p className="flow-card__lead">Pick a document type. You choose the vertical next.</p>

    <div className="choice-grid choice-grid--types" role="radiogroup" aria-label="Document type">
      {DOC_TYPE_INFO.map(({ value: type, short, description, icon: Icon }) => {
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            className={selected ? "choice choice--selected" : "choice"}
            onClick={() => onChange(type)}
            onDoubleClick={() => {
              onChange(type);
              onNext();
            }}
          >
            <span className="choice__head">
              <span className="choice__icon">
                <Icon aria-hidden />
              </span>
              {selected && <MdCheckCircle className="choice__check" aria-hidden />}
            </span>
            <span className="choice__title">{short}</span>
            {labelOf(DOC_TYPES, type) !== short && <span className="choice__subtitle">{labelOf(DOC_TYPES, type)}</span>}
            <span className="choice__description">{description}</span>
          </button>
        );
      })}
    </div>

    <div className="flow-actions">
      <span />
      <button type="button" className="flow-primary" onClick={onNext} disabled={!value}>
        Next: choose vertical <MdArrowForward aria-hidden />
      </button>
    </div>
  </section>
);
